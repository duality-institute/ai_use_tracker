import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spyOn } from "bun:test";
import { BoxRenderable, RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { UsageService } from "../src/core/service";
import { isRecord } from "../src/core/json";
import { UsageSidebar } from "../src/sidebar";

const root = resolve(import.meta.dir, "..");
const sandbox = await mkdtemp(join(tmpdir(), "ai-usage-plugin-"));
const previousData = process.env["XDG_DATA_HOME"];
process.env["XDG_DATA_HOME"] = sandbox;
const authPath = join(sandbox, "opencode", "auth.json");
const secret = "fixture-access-never-display";
let requests = 0;
let offline = false;
const network = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
  requests += 1;
  if (offline) throw new TypeError("fixture network unavailable");
  const url = new URL(input instanceof Request ? input.url : String(input));
  const headers = new Headers(init?.headers);
  assert.equal(headers.get("Authorization"), `Bearer ${secret}`);
  assert.equal(init?.redirect, "manual");
  const reset = new Date(Date.now() + 3_600_000).toISOString();
  if (url.host === "api.anthropic.com") {
    return Response.json({ limits: [
      { kind: "session", percent: 0.4, resets_at: reset },
      { kind: "weekly_all", percent: 105, resets_at: reset },
      { kind: "weekly_scoped", percent: 25, resets_at: reset, scope: { model: { display_name: "Fable" } } },
    ] });
  }
  assert.equal(url.host, "chatgpt.com");
  assert.equal(headers.get("ChatGPT-Account-Id"), "fixture-account");
  return Response.json({ rate_limit: { primary_window: { used_percent: 59, limit_window_seconds: 604800, reset_after_seconds: 3600 } } });
}, { preconnect() { throw new Error("Verification must not open real connections."); } }));

const [light, setLight] = createSignal(false);
const theme = {
  get current() {
    return {
      text: RGBA.fromHex(light() ? "#1a1a1a" : "#eeeeee"),
      textMuted: RGBA.fromHex(light() ? "#555555" : "#aaaaaa"),
      primary: RGBA.fromHex(light() ? "#2255aa" : "#88aaff"),
      warning: RGBA.fromHex(light() ? "#805400" : "#ffd080"),
      error: RGBA.fromHex(light() ? "#a00000" : "#ff8888"),
      backgroundPanel: RGBA.fromHex(light() ? "#fafafa" : "#141414"),
      backgroundElement: RGBA.fromHex(light() ? "#e8e8e8" : "#303030"),
      border: RGBA.fromHex(light() ? "#b8b8b8" : "#484848"),
      borderActive: RGBA.fromHex(light() ? "#b0b0b0" : "#505050"),
    };
  },
};

async function check(name: string, action: () => void | Promise<void>): Promise<void> {
  await action();
  console.log(`ok   ${name}`);
}

async function capture(service: UsageService, width = 36): Promise<string> {
  const view = await testRender(() => <UsageSidebar service={service} theme={theme} />, { width, height: 36 });
  try {
    await view.waitForVisualIdle();
    return view.captureCharFrame();
  } finally {
    view.renderer.destroy();
  }
}

try {
  await check("demo renders all four limits without reading credentials or fetching", async () => {
    const service = new UsageService({ demo: true, polling: false });
    try {
      await service.initialize();
      const frame = await capture(service);
      for (const text of ["Claude", "ChatGPT", "Fable", "82% used", "58% used", "31% used", "24% used", "Demo data"]) assert(frame.includes(text), text);
      const lines = frame.split("\n").map((line) => line.trimEnd());
      const splitter = "┈".repeat(36);
      const rule = "─".repeat(36);
      const content = lines.filter(Boolean);
      assert.equal(content[0], rule);
      assert.match(content[1] ?? "", /^Usage limit\s+Demo data ↻$/);
      assert.equal(content[2], splitter);
      assert.equal(content[3], "Claude");
      const chatgpt = lines.indexOf("ChatGPT");
      assert.equal(lines[chatgpt - 1], "");
      assert.match(lines[chatgpt - 2] ?? "", /^[━─]+\s+\d/);
      assert.match(content.at(-2) ?? "", /^[━─]+\s+\d/);
      assert.equal(content.at(-1), rule);
      assert.equal(content.filter((line) => line === splitter).length, 1);
      assert.equal(content.length, 14);
      assert.equal(requests, 0);
    } finally { service.dispose(); }
  });

  await check("quota labels and percentages align while slim bars expand and countdowns stay right-aligned", async () => {
    const service = new UsageService({ demo: true, polling: false });
    try {
      const barWidths: number[] = [];
      for (const width of [30, 36, 44]) {
        const lines = (await capture(service, width)).split("\n");
        const splitters = lines.filter((line) => /^┈+$/.test(line.trimEnd()));
        assert.equal(splitters.length, 1);
        assert(splitters.every((line) => line.trimEnd().length === width));
        const rules = lines.filter((line) => /^─+$/.test(line.trimEnd()));
        assert.equal(rules.length, 2);
        assert(rules.every((line) => line.trimEnd().length === width));
        const quotas = lines.filter((line) => line.includes("% used"));
        assert.equal(quotas.length, 4);
        const columns = quotas.map((line) => line.search(/\d+% used/));
        assert.equal(new Set(columns).size, 1);
        assert(columns.every((column) => column >= 0 && column <= 10));
        const bars = lines.filter((line) => /^[━─]+\s+\d+[mhd]/.test(line));
        assert.equal(bars.length, 4);
        assert(!lines.some((line) => line.includes("resets")));
        for (const countdown of ["2h 15m", "2d 3h", "6d 20h"]) assert(bars.some((line) => line.trimEnd().endsWith(countdown)));
        assert(bars.every((line) => line.trimEnd().length === width));
        const lengths = bars.map((line) => line.match(/^[━─]+/)?.[0].length ?? 0);
        assert.equal(new Set(lengths).size, 1);
        assert(lengths.every((length) => length > 10));
        barWidths.push(lengths[0] ?? 0);
      }
      const baseline = barWidths[0];
      assert(baseline !== undefined);
      assert.deepEqual(barWidths.map((width) => width - baseline), [0, 6, 14]);
    } finally { service.dispose(); }
  });

  await check("missing sign-ins render connection guidance without fetching", async () => {
    const service = new UsageService({ demo: false, polling: false });
    try {
      await service.initialize();
      assert(service.getState().providers.every((provider) => provider.status === "signed-out"));
      const lines = (await capture(service)).split("\n").map((line) => line.trimEnd());
      assert.match(lines[1] ?? "", /^Usage limit\s+Checked just now ↻$/);
      assert.equal(lines.filter((line) => line === "Use /connect.").length, 2);
      assert(lines.every((line) => !line.startsWith(" ")));
      assert.equal(requests, 0);
    } finally { service.dispose(); }
  });

  await mkdir(join(sandbox, "opencode"));
  const auth = JSON.stringify({
    anthropic: { type: "oauth", access: secret, refresh: "fixture-refresh-never-use", expires: Date.now() + 3_600_000 },
    openai: { type: "oauth", access: secret, refresh: "fixture-refresh-never-use", expires: Date.now() + 3_600_000, accountId: "fixture-account" },
  });
  await writeFile(authPath, auth);
  const service = new UsageService({ demo: false, polling: false });
  try {
    await check("concurrent refresh shares requests and renders real parser results in both themes", async () => {
      await Promise.all([service.initialize(), service.refresh()]);
      assert.equal(requests, 2);
      for (const mode of [false, true]) {
        setLight(mode);
        const frame = await capture(service);
        for (const text of ["<1% used", "105% used", "25% used", "59% used", "1h 0m"]) assert(frame.includes(text), text);
        assert(!frame.includes(secret));
      }
      assert.equal(await readFile(authPath, "utf8"), auth);
    });

    await check("clicking Refresh performs a new quota check", async () => {
      const view = await testRender(() => <UsageSidebar service={service} theme={theme} />, { width: 36, height: 36 });
      try {
        await view.renderOnce();
        const button = view.renderer.root.findDescendantById("ai-usage-refresh");
        assert(button instanceof BoxRenderable);
        assert.equal(button.border, false);
        assert.equal(button.height, 1);
        assert.equal(button.width, 3);
        assert.deepEqual(button.backgroundColor, theme.current.backgroundPanel);
        const before = requests;
        await view.mockMouse.click(button.x + Math.floor(button.width / 2), button.y + Math.floor(button.height / 2));
        await view.waitFor(() => requests === before + 2 && !service.getState().refreshing);
      } finally { view.renderer.destroy(); }
    });

    await check("failed refresh retains readings and marks them stale", async () => {
      offline = true;
      await service.refresh();
      assert(service.getState().providers.every((provider) => provider.status === "error" && provider.snapshot !== null));
      const frame = await capture(service);
      assert(frame.includes("stale"));
      assert(frame.includes("59% used"));
      assert.equal(await readFile(authPath, "utf8"), auth);
    });

    await check("expired sign-ins do not request or rewrite tokens", async () => {
      const expired = JSON.stringify({ anthropic: { type: "oauth", access: secret, refresh: secret, expires: 0 }, openai: { type: "api", key: secret } });
      await writeFile(authPath, expired);
      const before = requests;
      await service.refresh();
      assert.deepEqual(service.getState().providers.map((provider) => provider.status), ["expired", "signed-out"]);
      assert.equal(requests, before);
      assert.equal(await readFile(authPath, "utf8"), expired);
      assert(!(await capture(service)).includes(secret));
    });

    await check("malformed sign-ins produce safe errors and remain unchanged", async () => {
      const malformed = `{"access":"${secret}"`;
      await writeFile(authPath, malformed);
      await service.refresh();
      assert(service.getState().providers.every((provider) => provider.status === "error"));
      assert(!(await capture(service)).includes(secret));
      assert.equal(await readFile(authPath, "utf8"), malformed);
    });

    await check("disposed service cannot start more requests", async () => {
      service.dispose();
      const before = requests;
      await service.refresh();
      assert.equal(requests, before);
    });
  } finally { service.dispose(); }

  await check("bundle exports a TUI-only module and imports only host modules or Node built-ins", async () => {
    const file = resolve(root, "dist/tui.js");
    const source = await readFile(file, "utf8");
    for (const item of new Bun.Transpiler({ loader: "js" }).scan(source).imports) {
      assert(isBuiltin(item.path) || item.path === "solid-js" || item.path.startsWith("@opentui/"), item.path);
    }
    const imported: unknown = await import(pathToFileURL(file).href);
    assert(isRecord(imported) && isRecord(imported["default"]));
    assert.equal(typeof imported["default"]["tui"], "function");
    assert.equal(imported["default"]["server"], undefined);
  });

  await check("package has no runtime dependencies, platform restriction, or desktop files", async () => {
    const metadata: unknown = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
    assert(isRecord(metadata));
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "os", "cpu", "bin", "main"]) assert.equal(metadata[field], undefined, field);
    const result = spawnSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const packs: unknown = JSON.parse(result.stdout);
    assert(Array.isArray(packs) && isRecord(packs[0]) && Array.isArray(packs[0]["files"]));
    const files = packs[0]["files"].map((file: unknown) => {
      assert(isRecord(file) && typeof file["path"] === "string");
      return file["path"];
    });
    assert.deepEqual(files.sort(), ["LICENSE", "README.md", "dist/tui.js", "package.json"].sort());
  });
} finally {
  network.mockRestore();
  if (previousData === undefined) delete process.env["XDG_DATA_HOME"];
  else process.env["XDG_DATA_HOME"] = previousData;
  await rm(sandbox, { recursive: true, force: true });
}
