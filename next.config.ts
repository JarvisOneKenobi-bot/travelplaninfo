import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { buildSlugRedirects } from "./src/lib/slug-redirects";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  trailingSlash: true,
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
  async redirects() {
    return buildSlugRedirects();
  },
};

export default withNextIntl(nextConfig);
