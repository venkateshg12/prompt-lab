import type { NextConfig } from "next";

// As PaperTrail: Next bundles @repo/types (its built CommonJS dist/) for the browser.
// The Sentry wrapper is Phase 29.
const nextConfig: NextConfig = {
  transpilePackages: ["@repo/types", "@repo/scoring"],
};

export default nextConfig;
