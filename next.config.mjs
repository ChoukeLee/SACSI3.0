/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /* PERF: compress responses */
  compress: true,
  /* PERF: no sourcemaps in production (smaller bundle) */
  productionBrowserSourceMaps: false,
};

export default nextConfig;
