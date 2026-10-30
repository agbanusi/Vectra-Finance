import { createRequire } from "node:module";
import type { NextConfig } from "next";

const require = createRequire(import.meta.url);

function isInstalled(pkg: string): boolean {
  try {
    require.resolve(pkg);
    return true;
  } catch {
    return false;
  }
}

const config: NextConfig = {
  transpilePackages: ["@vectra/sdk"],
  reactStrictMode: true,
  // @vectra/sdk ships TS source with NodeNext-style ".js" specifiers; map them back to ".ts".
  // Turbopack has no extensionAlias equivalent, so dev/build run on webpack (see package.json).
  webpack(webpackConfig: { resolve?: { extensionAlias?: Record<string, string[]>; alias?: Record<string, string | false> } }) {
    webpackConfig.resolve = webpackConfig.resolve ?? {};
    webpackConfig.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    // WalletConnect's provider is an optional peer. Without it, the connector is simply unavailable.
    if (!isInstalled("@walletconnect/ethereum-provider")) {
      webpackConfig.resolve.alias = { ...webpackConfig.resolve.alias, "@walletconnect/ethereum-provider": false };
    }
    return webpackConfig;
  },
};

export default config;
