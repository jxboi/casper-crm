import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  // Pin Turbopack's root to the monorepo root (one level up) so it can compile the
  // workspace `@casper/*` sources and resolve the pnpm-hoisted `next` package, both of
  // which live outside this directory.
  turbopack: {
    root: fileURLToPath(new URL("..", import.meta.url)),
  },
  // The @casper/* engine packages ship raw TypeScript (exports point at src/*.ts),
  // so Next must transpile them rather than expecting pre-built JS.
  transpilePackages: [
    "@casper/platform",
    "@casper/auth",
    "@casper/events",
    "@casper/records",
    "@casper/workflow",
    "@casper/sales",
  ],
  // PGlite ships a WASM build + Node fs access; keep it out of the bundler and let
  // the Node server `require` it at runtime (the dev/test database, D-019).
  serverExternalPackages: ["@electric-sql/pglite"],
  // The @casper/* packages use `moduleResolution: bundler` but write NodeNext-style
  // `.js` specifiers that point at `.ts` sources. tsc/vitest tolerate this; webpack
  // needs the mapping made explicit. (Turbopack has no `extensionAlias` equivalent, so
  // this app runs `next dev --webpack`.)
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
