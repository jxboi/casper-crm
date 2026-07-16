import type { NextConfig } from "next";
import { resolve } from "node:path";

const config: NextConfig = {
  turbopack: { root: resolve(process.cwd(), "../..") },
  transpilePackages: ["@casper/auth", "@casper/records", "@casper/platform", "@casper/playground-kit"],
  serverExternalPackages: ["@electric-sql/pglite"],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },
};

export default config;
