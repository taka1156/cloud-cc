import {
  loadServices, loadTemplates, loadBundledSets, loadImported, saveImported,
  mergeSets, parseProblemFile, h,
} from "./data.js";
import {
  validateProblemSet, evaluate, conflictsWith, KIND_LABELS, SLOT_W, SLOT_H,
} from "./schema.js";

const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";

const state = {
  services: new Map(),
  templates: new Map(),
  sets: [],
  set: null,
  tpl: null,
  placed: {}, // 枠ID → 山札のindex（同じサービスが複数枚あっても区別できるようにindexで持つ）
};

const svcOf = (id) => state.services.get(id)
  ?? { id, name: id, color: "#999", placeableIn: [], cannotWith: [] };
const slotOf = (id) => state.tpl?.slots.find((s) => s.id === id);
/** 盤面に出す枠＝正解で使う枠だけ（テンプレートの他の枠は表示しない） */
const visibleSlots = () => (state.tpl?.slots ?? []).filter((s) => s.id in (state.set?.answer?.slots ?? {}));
const slotLabel = (id) => slotOf(id)?.label ?? id;
const showStatus = (msg) => { $("status").textContent = msg; };
const ctx = () => ({ services: state.services, templates: state.templates });

async function init() {
  try {
    const [services, templates] = await Promise.all([loadServices(), loadTemplates()]);
    state.services = new Map(services.map((s) => [s.id, s]));
    state.templates = templates;
    await reloadSets();
  } catch (e) {
    showStatus(`読込に失敗しました: ${e.message}\nhttp サーバー経由で開いてください（npm run serve）`);
  }
  $("set-select").addEventListener("change", (e) => openSet(e.target.value));
  $("import-file").addEventListener("change", onImport);
  $("judge").addEventListener("click", judge);
  $("reset").addEventListener("click", () => state.set && openSet(state.set.id));
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
  state.set = set;
  state.tpl = set ? state.templates.get(set.template) ?? null : null;
  state.placed = {};
  $("result").replaceChildren();
  if (!set) {
    $("problem").replaceChildren(h("p", {}, "問題セットがありません。JSONを取り込んでください。"));
  } else {
    $("set-select").value = set.id;
    if (!state.tpl) showStatus(`テンプレート "${set.template}" が見つかりません`);
    renderProblem();
  }
  renderAll();
}

function renderAll() {
  renderBoard();
  renderTray();
}

function renderProblem() {
  const s = state.set;
  $("problem").replaceChildren(
    h("h2", {}, s.title),
    h("p", { class: "meta" },
      `難易度 ${"★".repeat(s.difficulty)}　${state.tpl?.name ?? ""}　${(s.tags ?? []).join(" / ")}`),
    h("p", { class: "statement" }, s.statement),
    h("h3", {}, "要件"),
    h("ul", {}, (s.requirements ?? []).map((r) => h("li", {}, r))),
  );
}

/**
 * カードのアイコン。services.json の icon（例: "assets/aws/ec2.svg"）があれば画像を使い、
 * 無い・読めない場合はサービス色のバッジで代替する。
 */
function iconEl(id) {
  const svc = svcOf(id);
  const badge = () => h("span", { class: "badge", style: { background: svc.color } }, shortName(svc.name));
  const wrap = h("span", { class: "icon" });
  if (!svc.icon) {
    wrap.append(badge());
    return wrap;
  }
  const img = h("img", { src: svc.icon, alt: svc.name });
  img.draggable = false;
  img.addEventListener("error", () => wrap.replaceChildren(badge()));
  wrap.append(img);
  return wrap;
}

/** バッジ用の略称。大文字と数字を拾う（Route 53 → R53、CloudWatch → CW） */
function shortName(name) {
  const caps = name.replace(/[^A-Z0-9]/g, "");
  return (caps.length >= 2 ? caps : name.replace(/\s/g, "").slice(0, 2)).slice(0, 4);
}

function svgEl(tag, attrs, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text) el.textContent = text;
  return el;
}

/* ---------- 盤面 ---------- */

function renderBoard() {
  const board = $("board");
  if (!state.tpl) {
    board.replaceChildren(h("p", { class: "board-empty" }, "問題を選んでください"));
    return;
  }
  const { width: W, height: H } = state.tpl;
  board.style.aspectRatio = `${W} / ${H}`;

  // ゾーン（Region・AZ など）と固定の線は SVG で描く
  const svg = svgEl("svg", { class: "frame", viewBox: `0 0 ${W} ${H}` });
  for (const z of state.tpl.zones) {
    svg.append(
      svgEl("rect", { x: z.x, y: z.y, width: z.w, height: z.h, rx: 6, class: "zone" }),
      svgEl("text", { x: z.x + 10, y: z.y + 22, class: "zone-label" }, z.label),
    );
  }
  for (const [a, b] of state.set.links ?? []) {
    const sa = slotOf(a);
    const sb = slotOf(b);
    if (!sa || !sb) continue;
    svg.append(svgEl("line", {
      x1: sa.x + SLOT_W / 2, y1: sa.y + SLOT_H / 2,
      x2: sb.x + SLOT_W / 2, y2: sb.y + SLOT_H / 2,
      class: "fixed-link",
    }));
  }

  board.replaceChildren(svg, ...visibleSlots().map((s) => slotEl(s, W, H)));
}

function slotEl(s, W, H) {
  const style = {
    left: `${(s.x / W) * 100}%`,
    top: `${(s.y / H) * 100}%`,
    width: `${(SLOT_W / W) * 100}%`,
    height: `${(SLOT_H / H) * 100}%`,
  };
  const idx = state.placed[s.id];
  if (idx === undefined) {
    return h("div", { class: "slot empty", style, "data-slot": s.id },
      h("span", { class: "slot-label" }, s.label),
      h("span", { class: "slot-kind" }, KIND_LABELS[s.kind] ?? s.kind));
  }
  const svc = svcOf(state.set.deck[idx]);
  const el = h("div", {
    class: "slot filled",
    style: { ...style, borderTopColor: svc.color },
    "data-slot": s.id,
    title: `${s.label}: ${svc.name}`,
  }, iconEl(svc.id), h("span", { class: "card-name" }, svc.name));
  el.addEventListener("pointerdown", (e) => startDrag(e, idx, s.id));
  return el;
}

/* ---------- 山札 ---------- */

function renderTray() {
  const deck = state.set?.deck ?? [];
  const used = new Set(Object.values(state.placed));
  const rest = deck.map((id, i) => ({ id, i })).filter(({ i }) => !used.has(i));
  $("tray").replaceChildren(...rest.map(({ id, i }) => {
    const svc = svcOf(id);
    const el = h("div", { class: "tray-card", title: svc.description ?? svc.name, style: { borderTopColor: svc.color } },
      iconEl(id), h("span", {}, svc.name));
    el.addEventListener("pointerdown", (e) => startDrag(e, i, null));
    return el;
  }));
  $("remaining").textContent = state.set ? `山札 残り ${rest.length} / ${deck.length} 枚` : "";
}

/* ---------- 配置のルール（カード側の placeableIn / cannotWith） ---------- */

/** idx のカードを slotId に置けない理由を返す。置けるなら null */
function placeError(slotId, idx, ignore = []) {
  const slot = slotOf(slotId);
  const svc = svcOf(state.set.deck[idx]);
  if (!svc.placeableIn.includes(slot.kind)) {
    const where = svc.placeableIn.map((k) => KIND_LABELS[k] ?? k).join("・");
    return `${svc.name} は「${KIND_LABELS[slot.kind] ?? slot.kind}」の枠には置けません（置ける枠: ${where}）`;
  }
  for (const [sid, j] of Object.entries(state.placed)) {
    if (sid === slotId || ignore.includes(sid)) continue;
    const other = svcOf(state.set.deck[j]);
    if (conflictsWith(svc, other)) return `${svc.name} は ${other.name} と一緒には使えません`;
  }
  return null;
}

/** カードを枠に置く。置いてあったカードは、移動元の枠と入れ替えるか山札に戻す */
function place(slotId, idx, fromSlot) {
  const occupant = state.placed[slotId];
  const swapping = fromSlot && occupant !== undefined && occupant !== idx;
  const err = placeError(slotId, idx, fromSlot ? [fromSlot] : []);
  if (err) return showStatus(err);
  if (swapping) {
    const err2 = placeError(fromSlot, occupant, [slotId, fromSlot]);
    if (err2) return showStatus(`入れ替えできません: ${err2}`);
  }
  if (fromSlot) delete state.placed[fromSlot];
  if (swapping) state.placed[fromSlot] = occupant;
  state.placed[slotId] = idx;
  showStatus("");
  renderAll();
}

/** クリックしたカードを、置ける空き枠の先頭に入れる */
function autoPlace(idx) {
  for (const s of visibleSlots()) {
    if (state.placed[s.id] !== undefined) continue;
    if (!placeError(s.id, idx)) return place(s.id, idx, null);
  }
  const svc = svcOf(state.set.deck[idx]);
  showStatus(`${svc.name} を置ける空きの枠がありません`);
}

function markTargets(idx, fromSlot) {
  for (const el of document.querySelectorAll("#board .slot")) {
    el.classList.add(placeError(el.dataset.slot, idx, fromSlot ? [fromSlot] : []) ? "ng" : "ok");
  }
}

function clearTargets() {
  document.querySelectorAll("#board .slot").forEach((el) => el.classList.remove("ok", "ng"));
}

/**
 * カードのドラッグ。山札から（fromSlot=null）でも枠から（fromSlot=枠ID）でも同じ処理。
 * - 枠の上で離す → その枠に置く
 * - 枠のカードを山札の上で離す → 外して山札に戻す
 * - 動かさずに離す → 山札のカードなら空き枠に自動で置く
 */
function startDrag(e, idx, fromSlot) {
  if (e.button !== 0 || !state.tpl) return;
  e.preventDefault();
  const svc = svcOf(state.set.deck[idx]);
  const startX = e.clientX;
  const startY = e.clientY;
  let ghost = null;

  const move = (ev) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
      ghost = h("div", { class: "ghost", style: { borderTopColor: svc.color } },
        iconEl(svc.id), h("span", {}, svc.name));
      document.body.append(ghost);
      markTargets(idx, fromSlot);
    }
    ghost.style.left = `${ev.clientX}px`;
    ghost.style.top = `${ev.clientY}px`;
  };

  const up = (ev) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    clearTargets();
    if (!ghost) {
      if (!fromSlot) autoPlace(idx);
      return;
    }
    ghost.remove();
    const target = document.elementFromPoint(ev.clientX, ev.clientY);
    const slotNode = target?.closest(".slot");
    if (slotNode) {
      place(slotNode.dataset.slot, idx, fromSlot);
    } else if (fromSlot && target?.closest("#tray")) {
      delete state.placed[fromSlot];
      renderAll();
    }
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/* ---------- 判定 ---------- */

function judge() {
  const s = state.set;
  if (!s || !state.tpl) return;
  const placedBySlot = Object.fromEntries(
    Object.entries(state.placed).map(([slot, idx]) => [slot, s.deck[idx]]));
  if (!Object.keys(placedBySlot).length) {
    $("result").replaceChildren(h("p", { class: "meta" }, "カードを枠に置いてから判定してください"));
    return;
  }
  const r = evaluate(s, placedBySlot);
  const nameOf = (id) => svcOf(id).name;
  const parts = [
    h("div", { class: `verdict ${r.passed ? "pass" : "fail"}` },
      `${r.passed ? "合格" : "不合格"}　正解の枠 ${r.correct.length} / ${r.correct.length + r.missing.length}（${r.score}%）`),
    r.missing.length
      ? h("p", {}, `違う・空いている枠: ${r.missing.map((id) =>
        `${slotLabel(id)}${placedBySlot[id] ? `（${nameOf(placedBySlot[id])}）` : "（空）"}`).join("、")}`)
      : null,
    h("h3", {}, "模範解答"),
    h("ul", {}, Object.entries(s.answer.slots).map(([slot, svc]) =>
      h("li", {}, `${slotLabel(slot)}: ${nameOf(svc)}`))),
    h("h3", {}, "解説"),
    h("p", { class: "statement" }, s.explanation),
  ];
  $("result").replaceChildren(...parts.filter(Boolean));
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
    const errors = sets.flatMap((s) =>
      validateProblemSet(s, ctx()).map((m) => `[${s?.id ?? "?"}] ${m}`));
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
