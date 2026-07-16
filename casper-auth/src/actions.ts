/**
 * Namespaced action strings (auth plan). Centralized so they are typo-proof and
 * so the risk taxonomy (D-007) and grant tables can reference a closed set.
 * Field-level writes use the `record.field.write:<fieldKey>` form.
 */
export type RecordAction =
  | "record.read"
  | "record.create"
  | "record.update"
  | "record.archive"
  | "record.transition";

export type AdminAction =
  | "member.invite"
  | "member.role_change"
  | "member.remove"
  | "member.reassign"
  | "workspace.create"
  | "team.manage";

export type EngineAction = "changeset.approve" | "workflow.publish";
export type CollaborationAction =
  | "comment.create"
  | "comment.edit"
  | "comment.delete"
  | "view.create"
  | "notification.read";

export type FieldWriteAction = `record.field.write:${string}`;

export type Action = RecordAction | AdminAction | EngineAction | CollaborationAction | FieldWriteAction | "*";

const FIELD_WRITE_PREFIX = "record.field.write:";

export function isFieldWrite(action: string): action is FieldWriteAction {
  return action.startsWith(FIELD_WRITE_PREFIX);
}

export function fieldWriteKey(action: FieldWriteAction): string {
  return action.slice(FIELD_WRITE_PREFIX.length);
}

/**
 * Grant/action matching. A grant action may be:
 *  - "*"                     → matches everything
 *  - "record.*"             → prefix wildcard (matches `record.update`, etc.)
 *  - "record.field.write:*" → prefix wildcard for field writes
 *  - exact string           → matches only itself
 */
export function actionMatches(grantAction: string, action: string): boolean {
  if (grantAction === "*") return true;
  if (grantAction.endsWith("*")) {
    return action.startsWith(grantAction.slice(0, -1));
  }
  return grantAction === action;
}
