#!/usr/bin/env node
// 公開用の dist/ を作る。ブラウザが必要とするファイルだけをコピーし、
// スキル・スクリプト・README などの開発用ファイルは含めない。
// 使い方: node scripts/dist.mjs

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");

// 公開するもの（これ以外は配信されない）
const PUBLIC_PATHS = [
  "index.html",
  "css",
  "js",
  "editor",
  "assets",
  "data/services.json",
  "data/problems",
];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const rel of PUBLIC_PATHS) {
  const src = join(root, rel);
  if (!existsSync(src)) {
    console.error(`✗ 公開対象が見つかりません: ${rel}`);
    process.exit(1);
  }
  cpSync(src, join(out, rel), { recursive: true });
}

// GitHub Pages で Jekyll 処理を止め、ファイルをそのまま配信する
writeFileSync(join(out, ".nojekyll"), "");

console.log(`✓ dist/ を作成しました（公開対象: ${PUBLIC_PATHS.join(", ")}）`);
