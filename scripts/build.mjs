#!/usr/bin/env node
// サービス・テンプレート・問題セットを検証し、index.json を再生成する。
// 使い方:
//   node scripts/build.mjs          検証して index.json を更新
//   node scripts/build.mjs --check  検証のみ（index.json は書き換えない）

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KINDS, validateTemplate, validateProblemSet } from "../js/schema.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
let errorCount = 0;

const report = (label, errs) => {
  if (!errs.length) return;
  errorCount += errs.length;
  console.error(`✗ ${label}`);
  errs.forEach((m) => console.error(`    - ${m}`));
};

const readJsonFiles = (dir) => readdirSync(dir)
  .filter((f) => f.endsWith(".json") && f !== "index.json")
  .sort();

/* ---------- サービス ---------- */
const services = new Map();
const svcList = JSON.parse(readFileSync(join(root, "data/services.json"), "utf8")).services;
svcList.forEach((s) => services.set(s.id, s));
svcList.forEach((s) => {
  const errs = [];
  if (!Array.isArray(s.placeableIn) || s.placeableIn.length === 0) errs.push("placeableIn が必要です");
  (s.placeableIn ?? []).forEach((k) => { if (!KINDS.includes(k)) errs.push(`placeableIn の不明な種類: ${k}`); });
  (s.cannotWith ?? []).forEach((id) => { if (!services.has(id)) errs.push(`cannotWith の未知のサービス: ${id}`); });
  report(`services.json [${s.id}]`, errs);
});

/* ---------- テンプレート ---------- */
const tplDir = join(root, "data/templates");
const templates = new Map();
const tplFiles = readJsonFiles(tplDir);
const okTemplates = [];
for (const file of tplFiles) {
  let t;
  try {
    t = JSON.parse(readFileSync(join(tplDir, file), "utf8"));
  } catch (e) {
    report(file, [`JSON を解析できません (${e.message})`]);
    continue;
  }
  const errs = validateTemplate(t);
  if (t?.id && templates.has(t.id)) errs.push(`id が重複しています: ${t.id}`);
  report(file, errs);
  if (!errs.length) {
    templates.set(t.id, t);
    okTemplates.push(file);
  }
}

/* ---------- 問題セット ---------- */
const ctx = { services, templates };
const problemDir = join(root, "data/problems");
const seen = new Map();
const okProblems = [];
for (const file of readJsonFiles(problemDir)) {
  let sets;
  try {
    const data = JSON.parse(readFileSync(join(problemDir, file), "utf8"));
    sets = Array.isArray(data) ? data : Array.isArray(data.sets) ? data.sets : [data];
  } catch (e) {
    report(file, [`JSON を解析できません (${e.message})`]);
    continue;
  }
  let fileOk = true;
  for (const set of sets) {
    const errs = validateProblemSet(set, ctx);
    if (set && typeof set.id === "string") {
      if (seen.has(set.id)) errs.push(`id が ${seen.get(set.id)} と重複しています`);
      else seen.set(set.id, file);
    }
    if (errs.length) {
      fileOk = false;
      report(`${file} [${set?.id ?? "?"}]`, errs);
    }
  }
  if (fileOk) okProblems.push(file);
}

if (errorCount) {
  console.error(`\n${errorCount} 件のエラー。index.json は更新していません。`);
  process.exit(1);
}

if (!checkOnly) {
  writeFileSync(join(tplDir, "index.json"), JSON.stringify({ files: okTemplates }, null, 2) + "\n");
  writeFileSync(join(problemDir, "index.json"), JSON.stringify({ files: okProblems }, null, 2) + "\n");
}
console.log(`✓ テンプレート ${okTemplates.length} 件・問題ファイル ${okProblems.length} 件を検証OK${checkOnly ? "（--check）" : "。index.json を更新しました"}`);
