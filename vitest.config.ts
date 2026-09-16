import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Next preserves JSX for its compiler; DOM tests need executable JSX.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}", "tests/**/*.{test,spec}.{ts,tsx}"],
    environment: "node",
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
