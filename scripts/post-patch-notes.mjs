#!/usr/bin/env node
// Posts patch notes to Discord after each release. Runs at the tail of
// `npm run deploy`: collects commit subjects since the last posted release
// (tag `patchnotes/last`) and drops them into the updates channel via a
// channel webhook. No bot process, no token — one webhook URL.
//
// Webhook resolution: $PATCHNOTES_WEBHOOK_URL, else a gitignored
// `.patchnotes-webhook` file at the repo root. Unconfigured machines skip
// silently so deploys never depend on this posting.
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";

const execFile = promisify(execFileCallback);
const ROOT = path.resolve(import.meta.dirname, "..");
const TAG = "patchnotes/last";
// First run has no marker: cover recent history rather than all 78 commits.
const FIRST_RUN_DEPTH = 12;
const MAX_DESCRIPTION_CHARS = 3900;

const dryRun = process.argv.includes("--dry-run");

async function git(...args) {
  const { stdout } = await execFile("git", ["-C", ROOT, ...args]);
  return stdout.trim();
}

async function webhookUrl() {
  if (process.env.PATCHNOTES_WEBHOOK_URL) {
    return process.env.PATCHNOTES_WEBHOOK_URL.trim();
  }
  try {
    const stored = await readFile(path.join(ROOT, ".patchnotes-webhook"), "utf8");
    const url = stored.trim();
    return url || null;
  } catch {
    return null;
  }
}

async function lastPostedSha() {
  try {
    return await git("rev-parse", "-q", "--verify", `refs/tags/${TAG}`);
  } catch {
    return null;
  }
}

async function subjectRange(base) {
  const raw = await git("log", "--reverse", "--format=%s", `${base}..HEAD`);
  return raw.split("\n").map((line) => line.trim()).filter(Boolean);
}

function descriptionFrom(subjects) {
  const lines = subjects.map((subject) => `- ${subject}`);
  let description = lines.join("\n");
  if (description.length <= MAX_DESCRIPTION_CHARS) {
    return description;
  }
  // Cut on a bullet boundary so the ellipsis never splits a note mid-word.
  const kept = description.slice(0, MAX_DESCRIPTION_CHARS);
  const lastBullet = kept.lastIndexOf("\n- ");
  description =
    (lastBullet > 0 ? kept.slice(0, lastBullet) : kept) + "\n- …and more";
  return description;
}

async function main() {
  if (!dryRun && process.argv.slice(2).some((arg) => !arg.startsWith("--"))) {
    throw new Error(`unexpected argument: ${process.argv.slice(2).join(" ")}`);
  }

  const url = await webhookUrl();
  if (!url && !dryRun) {
    console.log("[patch-notes] no webhook configured — skipping");
    return;
  }

  const tagSha = await lastPostedSha();
  let base;
  if (tagSha) {
    base = tagSha;
  } else {
    const recent = (await git("rev-list", `--max-count=${FIRST_RUN_DEPTH + 1}`, "HEAD")).split("\n");
    if (recent.length < 2) {
      console.log("[patch-notes] nothing to announce yet — skipping");
      return;
    }
    base = recent[FIRST_RUN_DEPTH];
  }

  const subjects = await subjectRange(base);
  if (subjects.length === 0) {
    console.log("[patch-notes] no unreleased commits — skipping");
    return;
  }

  const head = await git("rev-parse", "--short", "HEAD");
  const payload = {
    username: "GeoRumble",
    embeds: [
      {
        title: `GeoRumble update — ${subjects.length} change${subjects.length === 1 ? "" : "s"}`,
        description: descriptionFrom(subjects),
        color: 0x5865f2,
        footer: { text: `deployed just now · ${head}` },
      },
    ],
  };

  if (dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    console.log(`[patch-notes] dry run: would post ${subjects.length} change(s) (${base.slice(0, 7)}..${head})`);
    return;
  }

  const response = await fetch(`${url}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    // Never fail the deploy over announcements; leaving the tag unmoved makes
    // the next successful deploy retry these same commits.
    const body = await response.text().catch(() => "");
    console.error(`[patch-notes] Discord refused the post (HTTP ${response.status}): ${body.slice(0, 300)}`);
    return;
  }
  await git("tag", "-f", TAG, "HEAD");
  console.log(`[patch-notes] posted ${subjects.length} change(s) to Discord`);
}

try {
  await main();
} catch (error) {
  console.error(`[patch-notes] failed (deploy unaffected): ${error.message}`);
}
