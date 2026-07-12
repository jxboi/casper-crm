import { and, eq } from "drizzle-orm";
import { on } from "@casper/events";
import { records } from "./schema.js";
import { hasRecordType } from "./registry.js";

/**
 * `last_activity_at` denormalizer. The events plan describes this as an events-side
 * concern, but D-001 says a module shouldn't write another module's table — so
 * records owns it as a *consumer* of the event stream, updating its own row. Any
 * domain event whose subject is one of our record types bumps that record's
 * activity timestamp; the `no_activity_within` filter operator reads it.
 */
export function registerActivityConsumer(): void {
  on(
    "*",
    async (event, tx) => {
      if (!hasRecordType(event.subject.type)) return;
      await tx
        .update(records)
        .set({ lastActivityAt: new Date(event.occurredAt) })
        .where(
          and(eq(records.id, event.subject.id), eq(records.type, event.subject.type)),
        );
    },
    "records:activity",
  );
}
