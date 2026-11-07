// Loopback-only visual QA. Synthetic records; no environment files or database.
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({
  configFile: false,
  envDir: false,
  publicDir: false,
  root: path.join(workspace, "tests/preview"),
  resolve: {
    alias: {
      "next/link": path.join(workspace, "tests/preview/room-link.tsx"),
      "@": path.join(workspace, "src"),
    },
  },
  oxc: { jsx: { runtime: "automatic" } },
  css: { postcss: workspace },
  server: { host: "127.0.0.1", port: 4178, strictPort: true, fs: { allow: [workspace] } },
});
await server.listen();
console.log("Synthetic room preview: http://127.0.0.1:4178/rooms.html");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await server.close();
    process.exit(0);
  });
