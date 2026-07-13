// casper-events — the event backbone (D-005). Every mutation emits a typed event
// in the same transaction; audit log and record timeline are projections of the
// stream. Emit within the caller's `withTx`, then `dispatchPending()` after commit.

export type {
  DomainEvent,
  EmitInput,
  InteractionInput,
  SubjectRef,
  EventSource,
} from "./envelope.js";

export { emit, emitInteraction } from "./emit.js";
export {
  withEmissionContext,
  currentEmission,
  type EmissionContext,
} from "./emission-context.js";
export { dispatchPending, BUILTIN_CONSUMER_NAMES } from "./dispatch.js";
export {
  on,
  registerEventTypes,
  getEventSchema,
  consumersFor,
  resetConsumers,
  type Consumer,
} from "./registry.js";
export {
  getTimeline,
  getAuditLog,
  type TimelineEntry,
  type AuditEntry,
} from "./queries.js";
export {
  addComment,
  editComment,
  deleteComment,
  listComments,
  parseMentions,
  type CommentModel,
  type AddCommentInput,
  type EditCommentInput,
} from "./comments.js";
export {
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
  NOTIFICATION_CONSUMER_NAMES,
  type NotificationModel,
} from "./notifications.js";
export { eventsMigrations } from "./migrations.js";
export * as schema from "./schema.js";
