import { requestContext } from "@casper/platform";
import { headers } from "next/headers";
import { getAuth } from "./auth.js";
import { getEngine, type EngineHandle } from "./engine.js";

/**
 * Run `fn` inside the dev principal's tenant context, booting the engine on first use.
 * Every server action / data read goes through here, so the tenancy context (org +
 * workspace + principal) is always established before any module API is called — the
 * same requirement the tests satisfy with `requestContext.run`.
 *
 * When real login lands, this is the one place that changes: resolve the principal from
 * the session instead of the fixed dev handle.
 */
export async function withEngine<T>(
  fn: (engine: EngineHandle) => Promise<T>,
): Promise<T> {
  let userId: string | undefined;
  if (process.env.DATABASE_URL) {
    const session = await getAuth().api.getSession({ headers: await headers() });
    userId = session?.user.id;
    if (!userId) throw new Error("Unauthenticated");
  }
  const engine = await getEngine(userId);
  return requestContext.run({ principal: engine.principal }, () => fn(engine));
}
