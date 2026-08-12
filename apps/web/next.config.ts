import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  ...(process.env.JINGSHU_NEXT_DIST_DIR
    ? { distDir: process.env.JINGSHU_NEXT_DIST_DIR }
    : {}),
  async rewrites() {
    const apiOrigin = process.env.JINGSHU_API_ORIGIN ?? "http://127.0.0.1:3001";
    return [
      {
        destination: `${apiOrigin}/api/v1/:path*`,
        source: "/api/v1/:path*",
      },
    ];
  },
};

export default nextConfig;
