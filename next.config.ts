import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import createNextIntlPlugin from "next-intl/plugin";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  // @serwist/next only hooks the webpack config; an empty turbopack config
  // satisfies Next 16's Turbopack-vs-webpack-config guard for `next dev`
  // (which runs on Turbopack by default) without opting dev into webpack.
  turbopack: {},
};

export default withSerwist(withNextIntl(nextConfig));
