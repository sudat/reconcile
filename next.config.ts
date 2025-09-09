import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // アップロードするXLSXに合わせて上限を引き上げ
      bodySizeLimit: "20mb",
    },
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // クライアント側でNode.jsモジュールを除外
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
      };
      
      // logger-node.jsをクライアント側から完全に除外
      config.resolve.alias = {
        ...config.resolve.alias,
        './logger-node': false,
      };
    }
    
    return config;
  },
};

export default nextConfig;
