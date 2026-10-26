import { join } from "node:path";
import type { NextConfig } from "next";

// /sell bundles the swarm's browser seller (../swarm/src/tab.ts) and its libp2p and Helia
// dependencies, which are installed in js/node_modules: so the root is js/, not this app.
const root = join(import.meta.dirname, "../..");

const nextConfig: NextConfig = {
  // A second dev server (the /sell e2e run) needs its own dir: Next locks .next/dev per server.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  outputFileTracingRoot: root,
  transpilePackages: ["ipfs-x402", "x402-libp2p"],
  turbopack: {
    root,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
