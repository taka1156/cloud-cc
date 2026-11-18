// データ読み込み・取り込み・書き出しの共通処理

const STORE_KEY = "cloud-cc:imported-sets";

/** サービスマスター（固定値）を読み込む */
export async function loadServices(base = "") {
  const res = await fetch(`${base}data/services.json`);
  if (!res.ok) throw new Error(`services.json の読込に失敗 (${res.status})`);
  return (await res.json()).services;
}

/** リポジトリ同梱の問題セットを読み込む（data/problems/index.json 経由） */
export async function loadBundledSets(base = "") {
  const res = await fetch(`${base}data/problems/index.json`);
  if (!res.ok) throw new Error(`問題一覧 index.json の読込に失敗 (${res.status})`);
  const { files } = await res.json();
  const lists = await Promise.all(files.map(async (file) => {
    const r = await fetch(`${base}data/problems/${file}`);
    if (!r.ok) throw new Error(`${file} の読込に失敗 (${r.status})`);
    return parseProblemFile(await r.text());
  }));
  return lists.flat();
}

/** 1ファイル分のJSON文字列を問題セットの配列にする（単体・配列・{sets:[]} に対応） */
export function parseProblemFile(text) {
  const data = JSON.parse(text);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.sets)) return data.sets;
  return [data];
}

/** ブラウザに取り込んだ問題セット（localStorage） */
export function loadImported() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) ?? [];
  } catch {
    return [];
  }
}

export function saveImported(sets) {
  localStorage.setItem(STORE_KEY, JSON.stringify(sets));
}

/** 同じidは後勝ちで統合する */
export function mergeSets(...lists) {
  const map = new Map();
  for (const list of lists) for (const s of list) map.set(s.id, s);
  return [...map.values()];
}

export function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 小さなDOMヘルパー。文字列は textContent として入るので外部データを安全に表示できる */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
