import { spawn } from "node:child_process";

const [rawModule, ...args] = process.argv.slice(2);
if (!rawModule || !["auth", "records", "casper-auth", "casper-records"].includes(rawModule)) {
  console.error("Usage: pnpm play <auth|records> [--port <port>]");
  process.exit(1);
}
const selected = rawModule.replace(/^casper-/, "");
const child = spawn("pnpm", ["--dir", "tooling/playground", "dev", ...args], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: "", PLAYGROUND_MODULE: selected },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
