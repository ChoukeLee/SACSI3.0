// Local visual QA only: synthetic records, no Next server, no Supabase client.
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({
  configFile: false, envDir: false, publicDir: false,
  root: path.join(workspace, "tests/preview"),
  resolve: { alias: { "@": path.join(workspace, "src") } },
  oxc: { jsx: { runtime: "automatic" } },
  css: { postcss: workspace },
  server: { host: "127.0.0.1", port: 4177, strictPort: true, fs: { allow: [workspace] } },
});
await server.listen();
console.log("Synthetic audit preview: http://127.0.0.1:4177/audit.html");
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await server.close(); process.exit(0); });
