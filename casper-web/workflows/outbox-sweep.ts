import { sweepOutbox } from "@casper/api";
import { sleep } from "workflow";

/** One daily Hobby-compatible run provides minute-level recovery for 24 hours. */
export async function outboxSweepWorkflow(
  limit = 500,
  iterations = 1_440,
): Promise<{ dispatched: number; sweeps: number }> {
  "use workflow";
  let dispatched = 0;
  for (let index = 0; index < iterations; index += 1) {
    const result = await drainStep(limit);
    dispatched += result.dispatched;
    if (index + 1 < iterations) await sleep("1m");
  }
  return { dispatched, sweeps: iterations };
}

async function drainStep(limit: number): Promise<{ dispatched: number }> {
  "use step";
  console.log(`[outbox-sweep] START limit=${limit}`);
  try {
    const dispatched = await sweepOutbox(limit);
    console.log(`[outbox-sweep] DONE dispatched=${dispatched}`);
    return { dispatched };
  } catch (error) {
    console.error(`[outbox-sweep] FAIL error=${String(error)}`);
    throw error;
  }
}
