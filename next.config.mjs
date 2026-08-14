import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /* PERF: compress responses */
  compress: true,
  /* PERF: no sourcemaps in production (smaller bundle) */
  productionBrowserSourceMaps: false,
  /* PERF: tree-shake barrel-file libraries — reduces JS bundle */
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-dialog",
      "@radix-ui/react-slot",
      "@radix-ui/react-tooltip",
      "@radix-ui/react-separator",
      "date-fns",
    ],
  },
};

const sentryOptions = {
  // Source-map upload only runs for release builds that provide credentials.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  telemetry: false,
  widenClientFileUpload: true,
};

export default withSentryConfig(nextConfig, sentryOptions);
