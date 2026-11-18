import {
  loadServices, loadTemplates, loadBundledSets, loadImported, saveImported,
  mergeSets, parseProblemFile, h,
} from "./data.js";
import {
  validateProblemSet, evaluate, conflictsWith, SLOT_W, SLOT_H,
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
  picked: null, // タップで選んだカード { idx, fromSlot }
  judged: null, // 判定結果（枠の色分けに使う）
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
  // 枠のカードを選んだ状態で山札の場所をタップすると、山札に戻す
  $("tray").addEventListener("click", (e) => { if (!e.target.closest(".tray-card")) returnPicked(); });

  // 画面の向きが変わったら盤面を描き直す
  let portrait = null;
  window.addEventListener("resize", () => {
    if (!state.tpl) return;
    const now = $("board").parentElement.clientWidth < 600;
    if (now !== portrait) {
      portrait = now;
      renderBoard();
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
  state.set = set;
  state.tpl = set ? state.templates.get(set.template) ?? null : null;
  state.placed = {};
  state.picked = null;
  state.judged = null;
  $("result").replaceChildren(h("p", { class: "meta" }, "枠にカードを置いたら「判定する」を押してください。"));
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

/**
 * 盤面の向き。縦長の画面（盤面の幅 < 600px）では、テンプレートの x と y を入れ替えて
 * 縦向きに描く。枠の大きさはそのままなので、スマホでも全部の枠が読める大きさで収まる。
 */
function layout() {
  const { width, height } = state.tpl;
  const portrait = $("board").parentElement.clientWidth < 600;
  // 点 (x, y) を表示座標へ。縦向きなら入れ替える
  const pt = portrait ? (x, y) => [y, x] : (x, y) => [x, y];
  return {
    portrait,
    W: portrait ? height : width,
    H: portrait ? width : height,
    pt,
    // 枠の左上（枠の中心を入れ替えて、大きさは変えない）
    slotPos: (s) => {
      const [cx, cy] = pt(s.x + SLOT_W / 2, s.y + SLOT_H / 2);
      return [cx - SLOT_W / 2, cy - SLOT_H / 2];
    },
    slotCenter: (s) => pt(s.x + SLOT_W / 2, s.y + SLOT_H / 2),
    rect: (z) => (portrait ? { x: z.y, y: z.x, w: z.h, h: z.w } : z),
  };
}

function renderBoard() {
  const board = $("board");
  if (!state.tpl) {
    board.replaceChildren(h("p", { class: "board-empty" }, "問題を選んでください"));
    return;
  }
  const L = layout();
  const { W, H } = L;
  board.style.aspectRatio = `${W} / ${H}`;
  board.classList.toggle("portrait", L.portrait);

  // ゾーン（Region・AZ など）と固定の線は SVG で描く
  const svg = svgEl("svg", { class: "frame", viewBox: `0 0 ${W} ${H}` });
  for (const zone of state.tpl.zones) {
    const z = L.rect(zone);
    svg.append(
      svgEl("rect", { x: z.x, y: z.y, width: z.w, height: z.h, rx: 6, class: "zone" }),
      svgEl("text", { x: z.x + 10, y: z.y + 22, class: "zone-label" }, zone.label),
    );
  }
  for (const [a, b] of state.set.links ?? []) {
    const sa = slotOf(a);
    const sb = slotOf(b);
    if (!sa || !sb) continue;
    const [x1, y1] = L.slotCenter(sa);
    const [x2, y2] = L.slotCenter(sb);
    svg.append(svgEl("line", { x1, y1, x2, y2, class: "fixed-link" }));
  }

  board.replaceChildren(svg, ...visibleSlots().map((s) => slotEl(s, L)));
}

function slotEl(s, L) {
  const { W, H } = L;
  const [x, y] = L.slotPos(s);
  const style = {
    left: `${(x / W) * 100}%`,
    top: `${(y / H) * 100}%`,
    width: `${(SLOT_W / W) * 100}%`,
    height: `${(SLOT_H / H) * 100}%`,
  };
  const idx = state.placed[s.id];
  const picked = state.picked;
  if (idx === undefined) {
    // 空き枠は役割の名前だけを出す（置けるカードの種類は出さない＝ヒントにしない）
    const el = h("div", { class: `slot empty${state.judged ? " wrong" : ""}`, style, "data-slot": s.id },
      h("span", { class: "slot-label" }, s.label));
    el.addEventListener("click", () => tapSlot(s.id));
    return el;
  }
  const svc = svcOf(state.set.deck[idx]);
  const sel = picked && picked.fromSlot === s.id;
  const mark = state.judged ? (state.judged.correct.includes(s.id) ? " right" : " wrong") : "";
  const el = h("div", {
    class: `slot filled${sel ? " picked" : ""}${mark}`,
    style: { ...style, "--c": svc.color },
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
    const sel = state.picked && state.picked.idx === i && !state.picked.fromSlot;
    const el = h("div", {
      class: `tray-card${sel ? " picked" : ""}`,
      title: svc.name,
      style: { "--c": svc.color },
    }, iconEl(id), h("span", { class: "card-name" }, svc.name));
    el.addEventListener("pointerdown", (e) => startDrag(e, i, null));
    return el;
  }));
  $("remaining").textContent = state.set ? `山札 残り ${rest.length} / ${deck.length} 枚` : "";
}

/* ---------- 配置 ---------- */

/**
 * カードを枠に置く。どのカードもどの枠にも置ける（間違いは判定で学ぶ）。
 * 置き先にカードがあれば、移動元の枠と入れ替えるか、山札に戻す。
 */
function place(slotId, idx, fromSlot) {
  const occupant = state.placed[slotId];
  if (fromSlot) delete state.placed[fromSlot];
  if (occupant !== undefined && occupant !== idx && fromSlot) state.placed[fromSlot] = occupant;
  state.placed[slotId] = idx;
  state.picked = null;
  state.judged = null;
  showStatus("");
  renderAll();
}

/* ---------- タップ操作（カードを選ぶ → 枠をタップ） ---------- */

function pick(idx, fromSlot) {
  const same = state.picked && state.picked.idx === idx && state.picked.fromSlot === fromSlot;
  state.picked = same ? null : { idx, fromSlot };
  showStatus(state.picked ? "置きたい枠をタップしてください" : "");
  renderAll();
}

function tapSlot(slotId) {
  if (!state.picked) return;
  place(slotId, state.picked.idx, state.picked.fromSlot);
}

function returnPicked() {
  if (!state.picked?.fromSlot) return;
  delete state.placed[state.picked.fromSlot];
  state.picked = null;
  state.judged = null;
  showStatus("");
  renderAll();
}

/**
 * カードの操作。山札から（fromSlot=null）でも枠から（fromSlot=枠ID）でも同じ処理。
 * - ドラッグして枠の上で離す → その枠に置く
 * - 枠のカードを山札の上で離す → 外して山札に戻す
 * - 動かさずに離す（タップ）→ そのカードを選ぶ。次に枠をタップすると置ける
 */
function startDrag(e, idx, fromSlot) {
  if (e.button !== 0 || !state.tpl) return;
  e.preventDefault();
  e.stopPropagation();
  const svc = svcOf(state.set.deck[idx]);
  const startX = e.clientX;
  const startY = e.clientY;
  let ghost = null;

  const move = (ev) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
      ghost = h("div", { class: "ghost", style: { "--c": svc.color } },
        iconEl(svc.id), h("span", { class: "card-name" }, svc.name));
      document.body.append(ghost);
    }
    ghost.style.left = `${ev.clientX}px`;
    ghost.style.top = `${ev.clientY}px`;
    lastY = ev.clientY;
    if (!scrollTimer) scrollTimer = setInterval(edgeScroll, 16);
  };

  // ドラッグ中に画面の上端・下端へ寄せたらページをスクロールする（縦長の盤面で上の枠に届くように）
  let lastY = startY;
  let scrollTimer = null;
  const edgeScroll = () => {
    const edge = 70;
    const trayTop = $("tray").getBoundingClientRect().top;
    const bottomEdge = Math.min(window.innerHeight, trayTop + 20);
    if (lastY < edge) window.scrollBy(0, -12);
    else if (lastY > bottomEdge - edge && lastY < trayTop) window.scrollBy(0, 12);
  };

  const up = (ev) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    clearInterval(scrollTimer);
    if (!ghost) {
      // 枠のカードを選んでいる状態で別の枠のカードをタップしたら、入れ替え
      if (fromSlot && state.picked && state.picked.fromSlot !== fromSlot) return tapSlot(fromSlot);
      pick(idx, fromSlot);
      return;
    }
    ghost.remove();
    const target = document.elementFromPoint(ev.clientX, ev.clientY);
    const slotNode = target?.closest(".slot");
    if (slotNode) {
      place(slotNode.dataset.slot, idx, fromSlot);
    } else if (fromSlot && target?.closest("#tray")) {
      delete state.placed[fromSlot];
      state.picked = null;
      state.judged = null;
      renderAll();
    }
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
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
  state.judged = r;
  state.picked = null;
  renderBoard();

  const nameOf = (id) => svcOf(id).name;

  // 間違えた枠ごとに、なぜ違うのかを返す（カード側のルール placeableIn を学びに使う）
  const feedback = r.missing.map((slotId) => {
    const slot = slotOf(slotId);
    const put = placedBySlot[slotId];
    if (!put) return `「${slot.label}」が空いています`;
    const svc = svcOf(put);
    if (!svc.placeableIn.includes(slot.kind)) {
      return `「${slot.label}」に ${svc.name} は役割が合いません（${svc.name}: ${svc.description}）`;
    }
    return `「${slot.label}」に ${svc.name} は置けますが、この問題の要件には合いません`;
  });

  // 一緒に使えないカードの組み合わせ（カード側のルール cannotWith）
  const used = [...new Set(Object.values(placedBySlot))].map(svcOf);
  const conflicts = [];
  used.forEach((a, i) => used.slice(i + 1).forEach((b) => {
    if (conflictsWith(a, b)) conflicts.push(`${a.name} と ${b.name} は一緒には使えません`);
  }));

  const parts = [
    h("div", { class: `verdict ${r.passed ? "pass" : "fail"}` },
      `${r.passed ? "合格" : "不合格"}　正解の枠 ${r.correct.length} / ${r.correct.length + r.missing.length}（${r.score}%）`),
    feedback.length || conflicts.length
      ? h("ul", { class: "feedback" }, [...feedback, ...conflicts].map((m) => h("li", {}, m)))
      : null,
    h("p", { class: "meta" }, "盤面の緑は正解、赤は間違いの枠です。カードを動かすと判定はやり直しになります。"),
    h("details", {},
      h("summary", {}, "模範解答と解説を見る"),
      h("ul", {}, Object.entries(s.answer.slots).map(([slot, svc]) =>
        h("li", {}, `${slotLabel(slot)}: ${nameOf(svc)}`))),
      h("p", { class: "statement" }, s.explanation)),
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
