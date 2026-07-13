import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  AppError,
  isUuid,
  newId,
  now,
  requestContext,
  withTx,
  type Tx,
} from "@casper/platform";
import { schema as authSchema } from "@casper/auth";
import { comments } from "./schema.js";
import { emit } from "./emit.js";
import { dispatchPending } from "./dispatch.js";
import type { SubjectRef } from "./envelope.js";

/**
 * Comments (events plan) — authored, timeline-native entries with @mentions and
 * edit/delete. Comments are their own source of truth (edits/deletes are live),
 * but every write emits a `comment.*` domain event so the audit log records it and
 * the notification consumer can fan out mentions. The record timeline reads
 * comments from this table (see `getTimeline`), so it never shows a stale body.
 *
 * Mentions are encoded in the body as `@[Display Name](user-id)`; callers may
 * also pass resolved ids explicitly. Either way ids are validated against active
 * workspace memberships, so a comment can only mention a real teammate.
 */
export interface CommentModel {
  id: string;
  record: SubjectRef;
  authorId: string;
  body: string;
  mentions: string[];
  createdAt: string;
  editedAt: string | null;
}

const MENTION_RE = /@\[[^\]]+\]\(([0-9a-fA-F-]{36})\)/g;

/** Extract mention ids from `@[Name](id)` tokens in a body. */
export function parseMentions(body: string): string[] {
  const ids = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) {
    if (m[1] && isUuid(m[1])) ids.add(m[1]);
  }
  return [...ids];
}

/**
 * Keep only ids that are active members of the acting workspace. Runs inside the
 * caller's tx (app role + RLS), so it can never resolve a user from another org.
 */
async function resolveMentions(
  tx: Tx,
  workspaceId: string,
  candidates: string[],
): Promise<string[]> {
  const valid = candidates.filter(isUuid);
  if (valid.length === 0) return [];
  const rows = await tx
    .select({ userId: authSchema.memberships.userId })
    .from(authSchema.memberships)
    .where(
      and(
        eq(authSchema.memberships.workspaceId, workspaceId),
        eq(authSchema.memberships.status, "active"),
        inArray(authSchema.memberships.userId, valid),
      ),
    );
  return rows.map((r) => r.userId);
}

function toModel(row: typeof comments.$inferSelect): CommentModel {
  return {
    id: row.id,
    record: { type: row.recordType, id: row.recordId },
    authorId: row.authorId,
    body: row.body,
    mentions: (row.mentions ?? []) as string[],
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
  };
}

async function loadComment(tx: Tx, id: string): Promise<typeof comments.$inferSelect> {
  const rows = await tx.select().from(comments).where(eq(comments.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.deletedAt) throw AppError.notFound(`comment ${id} not found`);
  return row;
}

export interface AddCommentInput {
  record: SubjectRef;
  body: string;
  /** Pre-resolved mention ids; when omitted they are parsed from `body`. */
  mentions?: string[];
}

export async function addComment(input: AddCommentInput): Promise<CommentModel> {
  const ctx = requestContext.require();
  const workspaceId = ctx.workspaceId ?? ctx.principal.workspaceId;
  if (!workspaceId) throw AppError.invalidState("comments require a workspace in context");
  const body = input.body.trim();
  if (!body) throw AppError.validation("comment body is empty");

  const id = newId();
  const ts = now();
  const candidates = input.mentions ?? parseMentions(body);

  const model = await withTx(async (tx) => {
    const mentions = await resolveMentions(tx, workspaceId, candidates);
    const rows = await tx
      .insert(comments)
      .values({
        id,
        orgId: ctx.orgId,
        workspaceId,
        recordType: input.record.type,
        recordId: input.record.id,
        authorId: ctx.principal.id,
        body,
        mentions,
        createdAt: ts,
      })
      .returning();
    await emit(tx, {
      type: "comment.created",
      subject: input.record,
      payload: { commentId: id, body, mentions },
    });
    return toModel(rows[0]!);
  });

  await dispatchPending();
  return model;
}

export interface EditCommentInput {
  id: string;
  body: string;
  mentions?: string[];
}

export async function editComment(input: EditCommentInput): Promise<CommentModel> {
  const ctx = requestContext.require();
  const body = input.body.trim();
  if (!body) throw AppError.validation("comment body is empty");

  const model = await withTx(async (tx) => {
    const existing = await loadComment(tx, input.id);
    // Only the author edits their own comment (edit/delete with audit).
    if (existing.authorId !== ctx.principal.id) {
      throw AppError.permissionDenied("only the author can edit a comment");
    }
    const mentions = await resolveMentions(
      tx,
      existing.workspaceId,
      input.mentions ?? parseMentions(body),
    );
    const rows = await tx
      .update(comments)
      .set({ body, mentions, editedAt: now() })
      .where(eq(comments.id, input.id))
      .returning();
    await emit(tx, {
      type: "comment.edited",
      subject: { type: existing.recordType, id: existing.recordId },
      payload: { commentId: input.id, body, mentions },
    });
    return toModel(rows[0]!);
  });

  await dispatchPending();
  return model;
}

export async function deleteComment(id: string): Promise<void> {
  const ctx = requestContext.require();
  await withTx(async (tx) => {
    const existing = await loadComment(tx, id);
    if (existing.authorId !== ctx.principal.id) {
      throw AppError.permissionDenied("only the author can delete a comment");
    }
    await tx.update(comments).set({ deletedAt: now() }).where(eq(comments.id, id));
    await emit(tx, {
      type: "comment.deleted",
      subject: { type: existing.recordType, id: existing.recordId },
      payload: { commentId: id },
    });
  });
  await dispatchPending();
}

export async function listComments(
  record: SubjectRef,
  opts: { limit?: number } = {},
): Promise<CommentModel[]> {
  return withTx(async (tx) => {
    const rows = await tx
      .select()
      .from(comments)
      .where(
        and(
          eq(comments.recordType, record.type),
          eq(comments.recordId, record.id),
          isNull(comments.deletedAt),
        ),
      )
      .orderBy(asc(comments.createdAt))
      .limit(opts.limit ?? 200);
    return rows.map(toModel);
  });
}
