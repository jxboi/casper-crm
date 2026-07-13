import { z } from "zod";
import { registerEventTypes } from "@casper/events";

/**
 * Change-set lifecycle events. Loose payload schemas for P1b — tightened as the
 * review/commit UX (casper-web) firms up the shapes it consumes.
 */
const lifecycleSchema = z.object({
  changesetId: z.string(),
  status: z.string().optional(),
  appliedChangeIds: z.array(z.string()).optional(),
  error: z.string().optional(),
});

const changeFlaggedSchema = z.object({
  changesetId: z.string(),
  changeId: z.string(),
  reason: z.string(),
});

export function registerChangesetEventTypes(): void {
  registerEventTypes({
    "changeset.created": lifecycleSchema,
    "changeset.submitted": lifecycleSchema,
    "changeset.approved": lifecycleSchema,
    "changeset.partially_approved": lifecycleSchema,
    "changeset.rejected": lifecycleSchema,
    "changeset.committed": lifecycleSchema,
    "changeset.commit_failed": lifecycleSchema,
    "changeset.rolled_back": lifecycleSchema,
    "change.flagged_stale": changeFlaggedSchema,
  });
}
