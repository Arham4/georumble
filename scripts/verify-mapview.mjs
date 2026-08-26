#!/usr/bin/env node
// Browser-level rendering verification for the map view. Exists because a
// one-line DOM-append regression shipped to production with typecheck, unit
// tests, and a build all green: only a real browser notices that Canada is
// missing from the map.
//
// For every shipped pack: solo-practice into a round and assert that the
// number of `.region` nodes in the DOM equals the pack's feature count, and
// that the camera transform is sane. Also asserts the portrait initial
// camera actually fills a tall viewport. Exits 0 only when everything holds.
//
// Usage: node scripts/verify-mapview.mjs [--keep-server]
// Requires a Chromium: env MAPVIEW_CHROME, else the newest playwright cache
// browser, else `chromium`/`google-chrome` on PATH. System libs are whatever
// that browser needs (playwright's `install-deps` covers a fresh box).
import { execFile as execFileCallback, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const execFile = promisify(execFileCallback);
const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 4173;
const BASE = `http://localhost:${PORT}/`;

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "✔" : "✖"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures += 1;
}

async function findChrome() {
  if (process.env.MAPVIEW_CHROME) return process.env.MAPVIEW_CHROME;
  try {
    const cache = path.join(process.env.HOME ?? "", ".cache", "ms-playwright");
    const dirs = (await readdir(cache)).filter((d) => d.startsWith("chromium_headless_shell-")).sort();
    for (const dir of dirs.reverse()) {
      for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell"]) {
        const bin = path.join(cache, dir, rel);
        await readFile(bin); // throws if missing
        return bin;
      }
    }
  } catch {
    // fall through to PATH lookup
  }
  for (const bin of ["chromium", "chromium-browser", "google-chrome"]) {
    try {
      await execFile("sh", ["-c", `command -v ${bin}`]);
      return bin;
    } catch {
      // try next
    }
  }
  return null;
}

async function waitForServer(url, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`dev server never came up at ${url}`);
}

async function main() {
  const chrome = await findChrome();
  if (!chrome) {
    console.error("No Chromium found: set MAPVIEW_CHROME or run `npx playwright install chromium`.");
    process.exit(1);
  }
  const require = createRequire(path.join(ROOT, "client", "package.json"));
  const { chromium } = require("playwright-core");

  console.log("building client…");
  await execFile("npm", ["--prefix", path.join(ROOT, "client"), "run", "build"]);
  // Spawn vite's bin directly: an `npx` wrapper would swallow kill() and
  // orphan the server past this script's exit.
  const server = spawn(
    path.join(ROOT, "client", "node_modules", ".bin", "vite"),
    ["preview", "--port", String(PORT), "--strictPort"],
    { cwd: path.join(ROOT, "client"), stdio: "ignore" },
  );
  try {
    await waitForServer(BASE);
    const manifestDir = path.join(ROOT, "assets", "mappacks");
    const packs = (await readdir(manifestDir)).filter((f) => f.endsWith(".mappack.json"));

    const browser = await chromium.launch({ executablePath: chrome, headless: true });

    for (const file of packs) {
      const pack = JSON.parse(await readFile(path.join(manifestDir, file), "utf8"));
      const label = pack.displayName;
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      try {
        await page.goto(BASE, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: "Solo practice" }).click({ timeout: 8000 });
        await page.waitForTimeout(800);
        await page.getByText(label, { exact: true }).first().click();
        await page.waitForTimeout(500);
        await page.getByRole("button", { name: /^Start/ }).first().click({ timeout: 8000 });
        await page.waitForTimeout(1500);
        const probe = await page.evaluate(() => ({
          regions: document.querySelectorAll("path.region").length,
          transform: document.querySelector("svg.map-svg > g")?.getAttribute("transform") ?? "",
        }));
        check(
          `${label}: every feature rendered`,
          probe.regions === pack.features.length,
          `${probe.regions}/${pack.features.length} region nodes`,
        );
        const scale = Number(/scale\(([\d.]+)\)/.exec(probe.transform)?.[1] ?? "1");
        check(`${label}: camera scale sane`, scale >= 1 && scale <= 2, `k=${scale}`);
      } catch (error) {
        check(`${label}: round playable`, false, String(error).slice(0, 120));
      } finally {
        await page.close();
      }
    }

    // Portrait: the initial camera must spend the letterbox bands on zoom.
    {
      const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
      try {
        await page.goto(BASE, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: "Solo practice" }).click({ timeout: 8000 });
        await page.waitForTimeout(800);
        await page.getByRole("button", { name: /^Start/ }).first().click({ timeout: 8000 });
        await page.waitForTimeout(1500);
        const transform = await page.evaluate(
          () => document.querySelector("svg.map-svg > g")?.getAttribute("transform") ?? "",
        );
        const scale = Number(/scale\(([\d.]+)\)/.exec(transform)?.[1] ?? "1");
        check("portrait: initial camera fills the viewport", scale > 1.2, `k=${scale}`);
      } catch (error) {
        check("portrait: initial camera fills the viewport", false, String(error).slice(0, 120));
      } finally {
        await page.close();
      }
    }

    await browser.close();
  } finally {
    server.kill();
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nmap view verified");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
