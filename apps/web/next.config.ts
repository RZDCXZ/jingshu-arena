import type { NextConfig } from "next";

const allowedDevOrigins = [
  "127.0.0.1",
  "localhost",
  ...(process.env.JINGSHU_DEV_ACCESS_HOST
    ? [process.env.JINGSHU_DEV_ACCESS_HOST]
    : []),
];

const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins: [...new Set(allowedDevOrigins)],
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
