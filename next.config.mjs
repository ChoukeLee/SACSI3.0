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

export default nextConfig;
