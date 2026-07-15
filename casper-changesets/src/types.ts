import { z } from "zod";
import type { Principal } from "@casper/platform";

/**
 * Change-set contracts (master-plan §6, D-006/D-007/D-026). A change set is a list
 * of declarative ops; commit applies them **through module write APIs**, never by
 * writing tables directly. Risk is *computed* (risk.ts), never caller-supplied.
 */

export const recordRefSchema = z.object({
  kind: z.literal("record"),
  type: z.string(),
  id: z.string().optional(),
});
export const configRefSchema = z.object({
  kind: z.literal("config"),
  configType: z.enum(["workflow", "automation", "field"]),
  recordType: z.string().optional(),
  version: z.number().int().optional(),
});
export const targetSchema = z.union([recordRefSchema, configRefSchema]);
export type ChangeTarget = z.infer<typeof targetSchema>;

export type Risk = "low" | "medium" | "high";
export type ChangeOp = "create" | "update" | "delete" | "transition" | "config_publish";
export type Origin = "ai_run" | "manual" | "feedback_proposal" | "workflow_publish";
export type ChangeSetStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "committing"
  | "committed"
  | "rejected"
  | "rolled_back";
export type Approval = "pending" | "approved" | "rejected";

export interface ValidationIssue {
  path: string;
  message: string;
}
export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface ChangeModel {
  id: string;
  changesetId: string;
  position: number;
  op: ChangeOp;
  target: ChangeTarget;
  payload: unknown;
  baseVersion: string | null;
  risk: Risk;
  approval: Approval;
  validation: ValidationResult;
  appliedAt: string | null;
}

export interface ChangeSetModel {
  id: string;
  orgId: string;
  workspaceId: string;
  author: Principal;
  origin: Origin;
  title: string;
  intent: string | null;
  status: ChangeSetStatus;
  createdAt: string;
  changes: ChangeModel[];
}

/** What a caller supplies to add a change (risk/validation/baseVersion are derived). */
export interface AddChangeInput {
  op: ChangeOp;
  target: ChangeTarget;
  payload: unknown;
}
