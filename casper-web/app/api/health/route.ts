import { runtimeHealth } from "@casper/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    return Response.json(await runtimeHealth());
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "runtime unavailable" },
      { status: 503 },
    );
  }
}
