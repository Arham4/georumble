#!/usr/bin/env node
// Runs the whole map-pack pipeline without a hand-maintained list. Every
// `scripts/build-*.mjs` file is a pack builder BY CONVENTION, so adding a
// pack means dropping one file here — no manifest edits to forget. Base
// data always downloads first, validation always sweeps last; builders in
// between write disjoint outputs, so alphabetical order is as good as any.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const SCRIPTS_DIR = import.meta.dirname;
const PACKS_DIR = path.resolve(SCRIPTS_DIR, "../assets/mappacks");

function run(script, args = []) {
  const result = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, script), ...args], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${script} failed (exit ${result.status ?? result.signal})`);
  }
}

run("fetch-mappacks.mjs");

const builders = readdirSync(SCRIPTS_DIR)
  .filter((name) => /^build-.+\.mjs$/.test(name))
  .sort();
for (const builder of builders) {
  run(builder);
}

const manifests = readdirSync(PACKS_DIR)
  .filter((name) => name.endsWith(".mappack.json"))
  .sort()
  .map((name) => path.join(PACKS_DIR, name));
run("validate-mappack.mjs", manifests);

console.log(
  `packs:build complete — ${builders.length} builders, ${manifests.length} packs validated`,
);
