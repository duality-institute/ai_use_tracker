import solidPlugin from "@opentui/solid/bun-plugin";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
await rm(resolve(root, "dist"), { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: [resolve(root, "src/tui.tsx")],
  outdir: resolve(root, "dist"),
  target: "bun",
  format: "esm",
  plugins: [solidPlugin],
  external: ["solid-js", "solid-js/*", "@opentui/core", "@opentui/core/*", "@opentui/solid", "@opentui/solid/*"],
});
if (!result.success) throw new AggregateError(result.logs, "TUI plugin build failed");
console.log("Built dist/tui.js; OpenCode supplies Solid and OpenTUI at runtime.");
