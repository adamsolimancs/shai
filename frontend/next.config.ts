import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  devIndicators: process.env.NEXT_DIST_DIR ? false : undefined,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  turbopack: {
    root: dirname,
  },
};

export default nextConfig;
