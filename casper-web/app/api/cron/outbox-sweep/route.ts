import { start } from "workflow/api";
import { outboxSweepWorkflow } from "@/workflows/outbox-sweep";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const requested = Number(new URL(request.url).searchParams.get("iterations"));
  const iterations = Number.isInteger(requested) && requested >= 1 && requested <= 1_440
    ? requested
    : 1_440;
  const run = await start(outboxSweepWorkflow, [500, iterations]);
  return Response.json({ ok: true, runId: run.runId }, { status: 202 });
}
