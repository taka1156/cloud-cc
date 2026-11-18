import {
  loadServices, loadBundledSets, loadImported, saveImported,
  mergeSets, parseProblemFile, h,
} from "./data.js";
import { validateProblemSet, evaluate, linkKey } from "./schema.js";

const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
const NODE_W = 120;
const NODE_H = 88;

const state = {
  services: new Map(),
  sets: [],
  set: null,
  placed: [],        // { id, x, y }  盤面に置いたサービス（座標は盤面内のpx）
  links: [],         // [A, B]        線（向きなし）
  selectedLink: null,// 選択中の線のindex
  connecting: null,  // { from, x, y } 引いている途中の線
};

const nameOf = (id) => state.services.get(id)?.name ?? id;
const linkLabel = ([a, b]) => `${nameOf(a)} ―― ${nameOf(b)}`;
const showStatus = (msg) => { $("status").textContent = msg; };
const placedIds = () => state.placed.map((p) => p.id);
const findPlaced = (id) => state.placed.find((p) => p.id === id);
const center = (id) => {
  const p = findPlaced(id);
  return p ? { x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 } : null;
};
const boardRect = () => $("board").getBoundingClientRect();
const toBoard = (clientX, clientY) => {
  const r = boardRect();
  return { x: clientX - r.left, y: clientY - r.top };
};
const clampX = (x) => Math.max(0, Math.min(x, boardRect().width - NODE_W));
const clampY = (y) => Math.max(0, Math.min(y, boardRect().height - NODE_H));
const hasLink = (a, b) => state.links.some(([x, y]) => linkKey(x, y) === linkKey(a, b));

async function init() {
  try {
    const services = await loadServices();
    state.services = new Map(services.map((s) => [s.id, s]));
    await reloadSets();
  } catch (e) {
    showStatus(`読込に失敗しました: ${e.message}\nhttp サーバー経由で開いてください（npm run serve）`);
  }
  $("set-select").addEventListener("change", (e) => openSet(e.target.value));
  $("import-file").addEventListener("change", onImport);
  $("judge").addEventListener("click", judge);
  $("reset").addEventListener("click", () => state.set && openSet(state.set.id));
  $("delete-link").addEventListener("click", deleteSelectedLink);

  // 盤面の空いている場所をクリックしたら線の選択を解除
  $("board").addEventListener("pointerdown", () => {
    if (state.selectedLink !== null) {
      state.selectedLink = null;
      renderBoard();
    }
  });
  window.addEventListener("keydown", (e) => {
    if ((e.key === "Delete" || e.key === "Backspace") && state.selectedLink !== null) {
      e.preventDefault();
      deleteSelectedLink();
    }
  });
}

/** 同梱 + 取り込み済みの問題セットを読み直す */
async function reloadSets(preferId) {
  let bundled = [];
  try {
    bundled = await loadBundledSets();
  } catch (e) {
    showStatus(`同梱の問題を読めませんでした: ${e.message}`);
  }
  state.sets = mergeSets(bundled, loadImported());
  $("set-select").replaceChildren(...state.sets.map((s) => h("option", { value: s.id }, s.title)));
  openSet(preferId);
}

function openSet(id) {
  const set = state.sets.find((s) => s.id === id) ?? state.sets[0] ?? null;
  $("result").replaceChildren();
  Object.assign(state, { set, placed: [], links: [], selectedLink: null, connecting: null });
  if (!set) {
    $("problem").replaceChildren(h("p", {}, "問題セットがありません。JSONを取り込んでください。"));
  } else {
    $("set-select").value = set.id;
    renderProblem();
  }
  renderTray();
  renderBoard();
}

function renderProblem() {
  const s = state.set;
  $("problem").replaceChildren(
    h("h2", {}, s.title),
    h("p", { class: "meta" }, `難易度 ${"★".repeat(s.difficulty)}　${(s.tags ?? []).join(" / ")}`),
    h("p", { class: "statement" }, s.statement),
    h("h3", {}, "要件"),
    h("ul", {}, (s.requirements ?? []).map((r) => h("li", {}, r))),
  );
}

/** AWSアイコン（assets/aws/<id>.svg）。無ければサービス色のバッジで代替する */
function iconEl(id) {
  const svc = state.services.get(id) ?? { name: id, color: "#999" };
  const wrap = h("span", { class: "icon" });
  const img = h("img", { src: `assets/aws/${id}.svg`, alt: svc.name });
  img.draggable = false;
  img.addEventListener("error", () => wrap.replaceChildren(badge(svc)));
  wrap.append(img);
  return wrap;
}

const badge = (svc) => h("span", { class: "badge", style: { background: svc.color } }, svc.name.slice(0, 3));

function svgEl(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/* ---------- 山札（トレイ） ---------- */

function renderTray() {
  const deck = state.set?.deck ?? [];
  $("tray").replaceChildren(...deck.map((id) => {
    const used = !!findPlaced(id);
    const el = h("div", { class: `tray-card${used ? " used" : ""}`, title: nameOf(id) },
      iconEl(id), h("span", {}, nameOf(id)));
    if (!used) el.addEventListener("pointerdown", (e) => startTrayDrag(e, id));
    return el;
  }));
}

/** 山札から盤面へドラッグ。動かさずに離した場合はクリックとして既定の位置に置く */
function startTrayDrag(e, id) {
  if (e.button !== 0) return;
  e.preventDefault();
  const startX = e.clientX;
  const startY = e.clientY;
  let ghost = null;

  const move = (ev) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
      ghost = h("div", { class: "ghost" }, iconEl(id), h("span", {}, nameOf(id)));
      document.body.append(ghost);
    }
    ghost.style.left = `${ev.clientX}px`;
    ghost.style.top = `${ev.clientY}px`;
  };

  const up = (ev) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    const dragged = !!ghost;
    ghost?.remove();
    if (!dragged) {
      addPlaced(id, defaultPos());
      return;
    }
    const r = boardRect();
    const inside = ev.clientX >= r.left && ev.clientX <= r.right
      && ev.clientY >= r.top && ev.clientY <= r.bottom;
    if (inside) {
      const p = toBoard(ev.clientX, ev.clientY);
      addPlaced(id, { x: clampX(p.x - NODE_W / 2), y: clampY(p.y - NODE_H / 2) });
    }
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function defaultPos() {
  const n = state.placed.length;
  return { x: 16 + (n % 4) * (NODE_W + 24), y: 16 + Math.floor(n / 4) * (NODE_H + 24) };
}

function addPlaced(id, pos) {
  if (findPlaced(id)) return;
  state.placed.push({ id, x: pos.x, y: pos.y });
  renderTray();
  renderBoard();
}

function removePlaced(id) {
  state.placed = state.placed.filter((p) => p.id !== id);
  state.links = state.links.filter(([a, b]) => a !== id && b !== id);
  state.selectedLink = null;
  renderTray();
  renderBoard();
}

/* ---------- 盤面 ---------- */

function renderBoard() {
  const svg = svgEl("svg", { class: "links" });

  state.links.forEach(([a, b], i) => {
    const pa = center(a);
    const pb = center(b);
    if (!pa || !pb) return;
    const coords = { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y };
    const hit = svgEl("line", { ...coords, class: "hit" });
    hit.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      state.selectedLink = i;
      renderBoard();
    });
    svg.append(hit, svgEl("line", { ...coords, class: i === state.selectedLink ? "link selected" : "link" }));
  });

  if (state.connecting) {
    const c = state.connecting;
    const a = center(c.from);
    svg.append(svgEl("line", { x1: a.x, y1: a.y, x2: c.x, y2: c.y, class: "link temp" }));
  }

  $("board").replaceChildren(svg, ...state.placed.map(nodeEl));
  $("delete-link").disabled = state.selectedLink === null;
  $("link-count").textContent = `線 ${state.links.length} 本`;
  $("board-empty").hidden = state.placed.length > 0;
}

function nodeEl(p) {
  const svc = state.services.get(p.id) ?? { name: p.id, color: "#999" };
  const el = h("div", {
    class: `node${state.connecting?.from === p.id ? " source" : ""}`,
    style: { left: `${p.x}px`, top: `${p.y}px`, borderTopColor: svc.color },
    "data-id": p.id,
  },
    iconEl(p.id),
    h("span", { class: "node-label" }, svc.name),
    h("button", {
      class: "remove",
      type: "button",
      title: "盤面から取り除く",
      onpointerdown: (e) => e.stopPropagation(),
      onclick: () => removePlaced(p.id),
    }, "×"),
    h("span", {
      class: "port",
      title: "ドラッグして別のカードにつなぐ",
      onpointerdown: (e) => startConnect(e, p.id),
    }),
  );
  el.addEventListener("pointerdown", (e) => startNodeMove(e, p.id));
  return el;
}

/** カードをドラッグして盤面内で動かす */
function startNodeMove(e, id) {
  if (e.button !== 0) return;
  const p = findPlaced(id);
  const r = boardRect();
  const offX = e.clientX - r.left - p.x;
  const offY = e.clientY - r.top - p.y;

  const move = (ev) => {
    const rr = boardRect();
    p.x = clampX(ev.clientX - rr.left - offX);
    p.y = clampY(ev.clientY - rr.top - offY);
    renderBoard();
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/** 端子（○）をドラッグして、別のカードの上で離すと線が引かれる */
function startConnect(e, from) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const c = center(from);
  state.selectedLink = null;
  state.connecting = { from, x: c.x, y: c.y };
  renderBoard();

  const move = (ev) => {
    const p = toBoard(ev.clientX, ev.clientY);
    state.connecting = { from, x: p.x, y: p.y };
    renderBoard();
  };
  const up = (ev) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".node")?.dataset.id;
    state.connecting = null;
    if (target && target !== from) {
      if (hasLink(from, target)) showStatus("その2つのカードはすでに線でつながっています");
      else state.links.push([from, target]);
    }
    renderBoard();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function deleteSelectedLink() {
  if (state.selectedLink === null) return;
  state.links.splice(state.selectedLink, 1);
  state.selectedLink = null;
  renderBoard();
}

/* ---------- 判定 ---------- */

function judge() {
  const s = state.set;
  if (!s) return;
  if (!state.placed.length) {
    $("result").replaceChildren(h("p", { class: "meta" }, "カードを盤面に置いてから判定してください"));
    return;
  }
  const r = evaluate(s, placedIds(), state.links);
  const ans = s.answer;
  $("result").replaceChildren(
    h("div", { class: `verdict ${r.passed ? "pass" : "fail"}` },
      `${r.passed ? "合格" : "不合格"}　一致率 ${r.score}%`),
    r.missingServices.length
      ? h("p", {}, `不足しているサービス: ${r.missingServices.map(nameOf).join(", ")}`) : null,
    r.missingFlows.length
      ? h("p", {}, `不足している線: ${r.missingFlows.map(linkLabel).join(", ")}`) : null,
    r.extra.length
      ? h("p", { class: "meta" }, `余分なカード（減点なし）: ${r.extra.map(nameOf).join(", ")}`) : null,
    h("h3", {}, "模範解答"),
    h("p", {}, `必須サービス: ${ans.requiredServices.map(nameOf).join(", ")}`),
    h("p", {}, `必要な線: ${(ans.requiredFlows ?? []).map(linkLabel).join(", ") || "なし"}`),
    h("h3", {}, "解説"),
    h("p", { class: "statement" }, s.explanation),
  );
}

/* ---------- 取り込み ---------- */

/** JSONを取り込む。検証に通ったものだけをブラウザに保存する */
async function onImport(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const sets = parseProblemFile(await file.text());
    if (!sets.length) throw new Error("問題セットが含まれていません");
    const ids = [...state.services.keys()];
    const errors = sets.flatMap((s) =>
      validateProblemSet(s, ids).map((m) => `[${s?.id ?? "?"}] ${m}`));
    if (errors.length) {
      showStatus(`取り込めませんでした:\n${errors.join("\n")}`);
      return;
    }
    saveImported(mergeSets(loadImported(), sets));
    showStatus(`${sets.length}件の問題を取り込みました`);
    await reloadSets(sets[0].id);
  } catch (err) {
    showStatus(`読込に失敗: ${err.message}`);
  }
}

init();
