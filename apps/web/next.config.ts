import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
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
