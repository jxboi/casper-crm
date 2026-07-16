import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FakeClock,
  newId,
  registerMigrations,
  requestContext,
  setClock,
  systemClock,
  withTx,
  type Principal,
} from "@casper/platform";
import { setupTestDb, resetPlatform } from "@casper/platform/testkit";
import {
  authMigrations,
  createOrg,
  createUser,
  createWorkspace,
  addMembership,
} from "@casper/auth/testkit";
import {
  eventsMigrations,
  addComment,
  editComment,
  deleteComment,
  listComments,
  getTimeline,
  emit,
  dispatchPending,
  listNotifications,
  unreadCount,
  markRead,
  type SubjectRef,
} from "./index.js";

interface World {
  orgId: string;
  wsId: string;
  alice: Principal;
  bob: Principal;
}

async function seedWorld(name: string): Promise<World> {
  const org = await createOrg(name);
  const ws = await createWorkspace(org.id, "Sales");
  const a = await createUser(`alice@${name}.test`, "Alice");
  const b = await createUser(`bob@${name}.test`, "Bob");
  await addMembership({ orgId: org.id, workspaceId: ws.id, userId: a.id, role: "member" });
  await addMembership({ orgId: org.id, workspaceId: ws.id, userId: b.id, role: "member" });
  return {
    orgId: org.id,
    wsId: ws.id,
    alice: { kind: "user", id: a.id, orgId: org.id, workspaceId: ws.id },
    bob: { kind: "user", id: b.id, orgId: org.id, workspaceId: ws.id },
  };
}

function as<T>(p: Principal, fn: () => Promise<T>): Promise<T> {
  return requestContext.run({ principal: p }, fn);
}

/** Emit a domain event directly (no records module) to exercise consumers. */
async function emitEvent(
  p: Principal,
  input: { type: string; subject: SubjectRef; payload: unknown },
): Promise<void> {
  await as(p, async () => {
    await withTx((tx) => emit(tx, input));
    await dispatchPending();
  });
}

const clock = new FakeClock();

describe("comments + notifications (events P0)", () => {
  let w: World;

  beforeEach(async () => {
    registerMigrations(authMigrations);
    registerMigrations(eventsMigrations);
    await setupTestDb();
    clock.set("2026-01-01T00:00:00.000Z");
    setClock(clock);
    w = await seedWorld("acme");
  });

  afterEach(() => {
    resetPlatform();
    setClock(systemClock);
  });

  const deal = (): SubjectRef => ({ type: "deal", id: "11111111-1111-1111-1111-111111111111" });

  it("adds a comment that lists and lands on the record timeline", async () => {
    const c = await as(w.alice, () => addComment({ record: deal(), body: "Looks promising" }));
    expect(c.authorId).toBe(w.alice.id);

    const list = await as(w.alice, () => listComments(deal()));
    expect(list.map((x) => x.body)).toEqual(["Looks promising"]);

    const tl = await as(w.alice, () => getTimeline(deal()));
    const entry = tl.find((e) => e.kind === "comment");
    expect(entry?.summary).toBe("Looks promising");
    expect((entry?.data as { commentId: string }).commentId).toBe(c.id);
  });

  it("@mention notifies the mentioned teammate but not the author", async () => {
    const body = `Hey @[Bob](${w.bob.id}) take a look`;
    await as(w.alice, () => addComment({ record: deal(), body }));

    const bobInbox = await as(w.bob, () => listNotifications());
    expect(bobInbox).toHaveLength(1);
    expect(bobInbox[0]).toMatchObject({ type: "mention" });
    expect(bobInbox[0]!.subject).toEqual(deal());

    // Alice mentioned nobody-but-herself effect: the author is never notified.
    const aliceInbox = await as(w.alice, () => listNotifications());
    expect(aliceInbox).toHaveLength(0);
  });

  it("drops mentions that are not active workspace members", async () => {
    const stranger = newId();
    await as(w.alice, () =>
      addComment({ record: deal(), body: `hi @[Ghost](${stranger})`, mentions: [stranger] }),
    );
    // No membership → no notification row anywhere in the org.
    const bobInbox = await as(w.bob, () => listNotifications());
    expect(bobInbox).toHaveLength(0);
  });

  it("marks notifications read (recipient only) and tracks unread count", async () => {
    await as(w.alice, () => addComment({ record: deal(), body: `@[Bob](${w.bob.id}) ping` }));

    expect(await as(w.bob, () => unreadCount())).toBe(1);
    const inbox = await as(w.bob, () => listNotifications({ unreadOnly: true }));
    const marked = await as(w.bob, () => markRead([inbox[0]!.id]));
    expect(marked).toBe(1);
    expect(await as(w.bob, () => unreadCount())).toBe(0);
  });

  it("only the author can edit/delete; timeline reflects edits and deletions live", async () => {
    const c = await as(w.alice, () => addComment({ record: deal(), body: "first" }));

    await expect(
      as(w.bob, () => editComment({ id: c.id, body: "hacked" })),
    ).rejects.toMatchObject({ code: "permission_denied" });

    clock.advance(1000);
    await as(w.alice, () => editComment({ id: c.id, body: "first (edited)" }));
    let tl = await as(w.alice, () => getTimeline(deal()));
    expect(tl.find((e) => e.kind === "comment")?.summary).toBe("first (edited)");

    await as(w.alice, () => deleteComment(c.id));
    expect(await as(w.alice, () => listComments(deal()))).toHaveLength(0);
    tl = await as(w.alice, () => getTimeline(deal()));
    expect(tl.some((e) => e.kind === "comment")).toBe(false);
  });

  it("notifies the assignee on task.created and task.updated (not self-assignment)", async () => {
    const task: SubjectRef = { type: "task", id: newId() };

    // Alice creates a task assigned to Bob.
    await emitEvent(w.alice, {
      type: "task.created",
      subject: task,
      payload: { data: { title: "Call", assignee: w.bob.id }, ownerId: w.alice.id },
    });
    expect(await as(w.bob, () => unreadCount())).toBe(1);

    // Reassigning to Bob again via update fires once more; self-assignment doesn't.
    await emitEvent(w.alice, {
      type: "task.updated",
      subject: task,
      payload: { diff: [{ field: "assignee", before: w.bob.id, after: w.bob.id }] },
    });
    await emitEvent(w.bob, {
      type: "task.updated",
      subject: task,
      payload: { diff: [{ field: "assignee", before: w.bob.id, after: w.bob.id }] },
    });

    const bobInbox = await as(w.bob, () => listNotifications());
    expect(bobInbox.filter((n) => n.type === "task_assigned")).toHaveLength(2);
  });

  it("redelivery does not double-notify (idempotent inbox)", async () => {
    await as(w.alice, () => addComment({ record: deal(), body: `@[Bob](${w.bob.id}) hi` }));
    // A second drain has nothing pending; the unique index also guards redelivery.
    await as(w.alice, () => dispatchPending());
    expect(await as(w.bob, () => unreadCount())).toBe(1);
  });
});
