import type { NextConfig } from "next";

const apiRewrite = process.env.RAILWAY_ENVIRONMENT
  ? ""
  : process.env.API_REWRITE_URL?.trim().replace(/\/$/, "");

const nextConfig: NextConfig = {
  serverExternalPackages: ["@typesafe-ai/sdk", "pg"],
  async rewrites() {
    if (!apiRewrite) return [];
    return {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: `${apiRewrite}/api/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
