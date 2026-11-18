#!/usr/bin/env node
// data/problems/*.json を検証し、data/problems/index.json を再生成する。
// 使い方:
//   node scripts/build.mjs          検証して index.json を更新
//   node scripts/build.mjs --check  検証のみ（index.json は書き換えない）

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateProblemSet } from "../js/schema.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const services = JSON.parse(readFileSync(join(root, "data/services.json"), "utf8")).services;
const serviceIds = services.map((s) => s.id);
const dir = join(root, "data/problems");

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json") && f !== "index.json")
  .sort();

const seen = new Map();
const okFiles = [];
let errorCount = 0;

for (const file of files) {
  let sets;
  try {
    const data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    sets = Array.isArray(data) ? data : Array.isArray(data.sets) ? data.sets : [data];
  } catch (e) {
    console.error(`✗ ${file}: JSON を解析できません (${e.message})`);
    errorCount++;
    continue;
  }

  let fileOk = true;
  for (const set of sets) {
    const errs = validateProblemSet(set, serviceIds);
    if (set && typeof set.id === "string") {
      if (seen.has(set.id)) errs.push(`id が ${seen.get(set.id)} と重複しています`);
      else seen.set(set.id, file);
    }
    if (errs.length) {
      fileOk = false;
      errorCount++;
      console.error(`✗ ${file} [${set?.id ?? "?"}]`);
      errs.forEach((m) => console.error(`    - ${m}`));
    }
  }
  if (fileOk) okFiles.push(file);
}

if (errorCount) {
  console.error(`\n${errorCount} 件のエラー。index.json は更新していません。`);
  process.exit(1);
}

if (!checkOnly) {
  writeFileSync(join(dir, "index.json"), JSON.stringify({ files: okFiles }, null, 2) + "\n");
}
console.log(`✓ ${okFiles.length} ファイルを検証OK${checkOnly ? "（--check）" : "。index.json を更新しました"}`);
