// データ読み込み・取り込み・書き出しの共通処理

const STORE_KEY = "cloud-cc:imported-sets";

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} の読込に失敗 (${res.status})`);
  return res.json();
}

/** サービスマスター（固定値） */
export async function loadServices(base = "") {
  return (await getJson(`${base}data/services.json`)).services;
}

/** 盤面テンプレート。Map<id, template> で返す */
export async function loadTemplates(base = "") {
  const { files } = await getJson(`${base}data/templates/index.json`);
  const list = await Promise.all(files.map((f) => getJson(`${base}data/templates/${f}`)));
  return new Map(list.map((t) => [t.id, t]));
}

/** リポジトリ同梱の問題セット（data/problems/index.json 経由） */
export async function loadBundledSets(base = "") {
  const { files } = await getJson(`${base}data/problems/index.json`);
  const lists = await Promise.all(files.map(async (f) => {
    const res = await fetch(`${base}data/problems/${f}`);
    if (!res.ok) throw new Error(`${f} の読込に失敗 (${res.status})`);
    return parseProblemFile(await res.text());
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
    else if (k === "style" && typeof v === "object") {
      // "--c" のようなCSS変数は setProperty でないと入らない
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith("--")) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    }
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
