import { startRun, type RunEvent } from "@casper/ai";
import { withEngine } from "@/lib/server/context";

/**
 * The assistant-run SSE endpoint. Starts a real `casper-ai` run in-process and streams
 * its `RunEvent`s to the dock as Server-Sent Events. The run executes the model/tool
 * loop and ends by staging a draft change set — approval + commit stay a separate human
 * action (the Approvals inbox / dock Changes tab), so nothing here writes a record.
 *
 * This is the SSE origin the dock's conversation/plan surfaces were waiting on (D-019):
 * the loop lives in-process for the dogfood slice; WDK durability layers on later.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const { assistantKey, request } = (await req.json()) as { assistantKey: string; request: string };
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: RunEvent | { type: "done" }) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        await withEngine(() => startRun({ assistantKey, request, onEvent: send }));
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "the run could not be started" });
      } finally {
        send({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
