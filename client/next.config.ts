import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  env: {
    API_URL: "https://parallel-chat-backend.fly.dev/v1",
  },
};

export default nextConfig;
