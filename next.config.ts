import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // アップロードするXLSXに合わせて上限を引き上げ
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
