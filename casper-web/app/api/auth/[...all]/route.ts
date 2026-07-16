import { getAuth } from "@/lib/server/auth";
import { initializeEngine } from "@/lib/server/engine";

export const runtime = "nodejs";

async function handle(request: Request): Promise<Response> {
  await initializeEngine();
  return getAuth().handler(request);
}

export const GET = handle;
export const POST = handle;
