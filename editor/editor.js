import {
  loadServices, loadTemplates, loadBundledSets, parseProblemFile, download, h,
} from "../js/data.js";
import { validateProblemSet, linkKey, KIND_LABELS } from "../js/schema.js";

const $ = (id) => document.getElementById(id);
const state = { services: new Map(), templates: new Map(), sets: [], index: -1 };
const cur = () => state.sets[state.index];
const ctx = () => ({ services: state.services, templates: state.templates });
const tplOf = (set) => (set ? state.templates.get(set.template) : undefined);
const nameOf = (id) => state.services.get(id)?.name ?? id;
const slotLabel = (id) => tplOf(cur())?.slots.find((s) => s.id === id)?.label ?? id;
const splitList = (v, sep) => v.split(sep).map((x) => x.trim()).filter(Boolean);
const MAX_COPIES = 6;

// フォームの項目と問題セットのキーの対応
const FIELDS = {
  id: { parse: (v) => v.trim(), show: (v) => v ?? "" },
  title: { parse: (v) => v, show: (v) => v ?? "" },
  difficulty: { parse: (v) => Number(v), show: (v) => String(v ?? 1) },
  tags: { parse: (v) => splitList(v, ","), show: (v) => (v ?? []).join(", ") },
  statement: { parse: (v) => v, show: (v) => v ?? "" },
  requirements: { parse: (v) => splitList(v, "\n"), show: (v) => (v ?? []).join("\n") },
  explanation: { parse: (v) => v, show: (v) => v ?? "" },
};

const blank = () => ({
  schemaVersion: 2,
  id: "new-problem-001",
  title: "新しい問題",
  difficulty: 1,
  tags: [],
  statement: "",
  requirements: [],
  template: [...state.templates.keys()][0] ?? "",
  deck: [],
  answer: { slots: {} },
  links: [],
  explanation: "",
});

function toast(msg) {
  $("toast").textContent = msg;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("toast").textContent = ""), 5000);
}

/** 古い形式や欠けた項目があっても編集できるように最低限の形を整える */
function normalize(set) {
  set.answer = set.answer && typeof set.answer === "object" ? set.answer : {};
  set.answer.slots = set.answer.slots && typeof set.answer.slots === "object" ? set.answer.slots : {};
  set.deck = Array.isArray(set.deck) ? set.deck : [];
  set.links = Array.isArray(set.links) ? set.links : [];
  return set;
}

/** 問題セットの検証（ID重複も含む） */
function errorsOf(set) {
  const errs = validateProblemSet(set, ctx());
  if (state.sets.filter((s) => s.id === set.id).length > 1) errs.push("id が他の問題と重複しています");
  return errs;
}

function upsert(set) {
  normalize(set);
  const i = state.sets.findIndex((s) => s.id === set.id);
  if (i >= 0) state.sets[i] = set;
  else state.sets.push(set);
}

function select(i) {
  state.index = i;
  fillForm(cur());
  renderAll();
}

function renderAll() {
  renderList();
  renderDeck();
  renderAnswer();
  renderLinks();
  renderPreview();
}

function fillForm(set) {
  $("form").disabled = !set;
  for (const [key, f] of Object.entries(FIELDS)) {
    $(`f-${key}`).value = set ? f.show(set[key]) : "";
  }
  $("f-template").replaceChildren(...[...state.templates.values()].map((t) =>
    h("option", { value: t.id }, `${t.name}（${t.id}）`)));
  $("f-template").value = set?.template ?? "";
  $("template-desc").textContent = tplOf(set)?.description ?? "";
}

/** フォームの入力を現在の問題セットへ反映する */
function readForm() {
  const set = cur();
  if (!set) return;
  for (const [key, f] of Object.entries(FIELDS)) set[key] = f.parse($(`f-${key}`).value);
}

function onEdit() {
  readForm();
  renderList();
  renderPreview();
}

/* ---------- テンプレート ---------- */

function onTemplateChange() {
  const set = cur();
  if (!set) return;
  set.template = $("f-template").value;
  const ids = new Set((tplOf(set)?.slots ?? []).map((s) => s.id));
  // 新しいテンプレートにない枠の正解と線は外す
  for (const slot of Object.keys(set.answer.slots)) if (!ids.has(slot)) delete set.answer.slots[slot];
  set.links = set.links.filter(([a, b]) => ids.has(a) && ids.has(b));
  $("template-desc").textContent = tplOf(set)?.description ?? "";
  renderAll();
}

/* ---------- 山札 ---------- */

function renderDeck() {
  const set = cur();
  const counts = {};
  (set?.deck ?? []).forEach((id) => { counts[id] = (counts[id] ?? 0) + 1; });
  $("deck-grid").replaceChildren(...[...state.services.values()].map((svc) => {
    const input = h("input", {
      type: "number", min: "0", max: String(MAX_COPIES),
      value: String(counts[svc.id] ?? 0), "data-id": svc.id,
    });
    input.disabled = !set;
    input.addEventListener("change", setDeckFromInputs);
    const where = svc.placeableIn.map((k) => KIND_LABELS[k] ?? k).join("・");
    return h("label", { class: "qty", title: `置ける枠: ${where}` },
      input, svc.name, h("small", {}, where));
  }));
}

function setDeckFromInputs() {
  const set = cur();
  if (!set) return;
  const deck = [];
  document.querySelectorAll("#deck-grid input").forEach((inp) => {
    const n = Math.max(0, Math.min(MAX_COPIES, Math.floor(Number(inp.value) || 0)));
    for (let i = 0; i < n; i++) deck.push(inp.dataset.id);
  });
  set.deck = deck;
  // 山札から消えたカードを正解から外す
  for (const [slot, svc] of Object.entries(set.answer.slots)) {
    if (!deck.includes(svc)) delete set.answer.slots[slot];
  }
  set.links = set.links.filter(([a, b]) => a in set.answer.slots && b in set.answer.slots);
  renderAll();
}

/* ---------- 正解 ---------- */

function renderAnswer() {
  const set = cur();
  const tpl = tplOf(set);
  if (!set || !tpl) {
    $("answer-grid").replaceChildren(h("p", { class: "meta" }, "テンプレートを選ぶと枠ごとの正解を設定できます"));
    return;
  }
  const deckIds = [...new Set(set.deck)];
  $("answer-grid").replaceChildren(...tpl.slots.map((slot) => {
    const current = set.answer.slots[slot.id] ?? "";
    const options = deckIds.filter((id) => state.services.get(id)?.placeableIn.includes(slot.kind));
    if (current && !options.includes(current)) options.push(current);
    const sel = h("select", {},
      h("option", { value: "" }, "（使わない）"),
      ...options.map((id) => h("option", { value: id }, nameOf(id))));
    sel.value = current;
    sel.addEventListener("change", () => {
      if (sel.value) {
        set.answer.slots[slot.id] = sel.value;
      } else {
        delete set.answer.slots[slot.id];
        // 使わない枠は盤面に出ないので、その枠の線も外す
        set.links = set.links.filter(([a, b]) => a !== slot.id && b !== slot.id);
      }
      renderAll();
    });
    return h("div", { class: "row slot-row" },
      h("span", { class: "slot-name" }, `${slot.label}（${KIND_LABELS[slot.kind] ?? slot.kind}）`),
      sel);
  }));
}

/* ---------- 線 ---------- */

function renderLinks() {
  const set = cur();
  // 線は盤面に出る枠（正解で使う枠）どうしにだけ引ける
  const slots = (tplOf(set)?.slots ?? []).filter((s) => s.id in (set?.answer.slots ?? {}));
  const options = () => slots.map((s) => h("option", { value: s.id }, s.label));
  $("link-from").replaceChildren(...options());
  $("link-to").replaceChildren(...options());
  $("link-list").replaceChildren(...(set?.links ?? []).map(([a, b], i) => h("li", {},
    `${slotLabel(a)} ―― ${slotLabel(b)} `,
    h("button", { type: "button", onclick: () => { set.links.splice(i, 1); renderAll(); } }, "削除"),
  )));
}

function addLink() {
  const set = cur();
  if (!set) return;
  const a = $("link-from").value;
  const b = $("link-to").value;
  if (!a || !b || a === b) return toast("線でつなぐ枠を2つ、別々に選んでください");
  if (set.links.some(([x, y]) => linkKey(x, y) === linkKey(a, b))) return toast("その線はすでにあります");
  set.links.push([a, b]);
  renderAll();
}

/* ---------- 一覧・プレビュー ---------- */

function renderPreview() {
  const set = cur();
  $("preview").value = set ? JSON.stringify(set, null, 2) : "";
  const errs = set ? errorsOf(set) : [];
  $("errors").replaceChildren(...(set
    ? (errs.length ? errs : ["✓ 問題ありません"])
    : ["問題を選択してください"]).map((m) => h("li", {}, m)));
}

function renderList() {
  $("set-list").replaceChildren(...state.sets.map((s, i) => {
    const n = errorsOf(s).length;
    return h("li", { class: i === state.index ? "active" : "", onclick: () => select(i) },
      h("span", {}, s.title || s.id),
      h("small", {}, n ? `⚠ ${n}` : "✓"));
  }));
}

/** 一括取り込み後に選択を整える */
function afterBulk() {
  select(state.sets.length ? Math.max(state.index, 0) : -1);
}

/* ---------- 初期化 ---------- */

async function init() {
  try {
    const [services, templates] = await Promise.all([loadServices("../"), loadTemplates("../")]);
    state.services = new Map(services.map((s) => [s.id, s]));
    state.templates = templates;
  } catch (e) {
    toast(`マスターデータを読めません: ${e.message}（http サーバー経由で開いてください）`);
  }

  for (const key of Object.keys(FIELDS)) $(`f-${key}`).addEventListener("input", onEdit);
  $("f-template").addEventListener("change", onTemplateChange);
  $("link-add").addEventListener("click", addLink);

  $("btn-new").addEventListener("click", () => {
    state.sets.push(blank());
    select(state.sets.length - 1);
  });

  $("btn-delete").addEventListener("click", () => {
    const s = cur();
    if (!s || !confirm(`「${s.title || s.id}」を一覧から削除しますか？`)) return;
    state.sets.splice(state.index, 1);
    state.index = Math.min(state.index, state.sets.length - 1);
    afterBulk();
  });

  $("btn-import").addEventListener("change", async (e) => {
    for (const file of e.target.files) {
      try {
        parseProblemFile(await file.text()).forEach(upsert);
      } catch (err) {
        toast(`${file.name}: ${err.message}`);
      }
    }
    e.target.value = "";
    afterBulk();
  });

  $("btn-bundled").addEventListener("click", async () => {
    try {
      const sets = await loadBundledSets("../");
      sets.forEach(upsert);
      toast(`${sets.length}件を読み込みました`);
      afterBulk();
    } catch (err) {
      toast(err.message);
    }
  });

  $("btn-export-one").addEventListener("click", () => {
    const s = cur();
    if (s) download(`${s.id}.json`, JSON.stringify(s, null, 2) + "\n");
  });

  $("btn-export-all").addEventListener("click", () => {
    if (!state.sets.length) return toast("書き出す問題がありません");
    download("problem-sets.json", JSON.stringify(state.sets, null, 2) + "\n");
  });

  $("btn-paste").addEventListener("click", () => {
    try {
      const sets = parseProblemFile($("paste").value);
      if (sets.length !== 1) return toast("貼り付けは1問題のみ対応です（複数はJSON読込を使用）");
      const set = normalize(sets[0]);
      if (state.index >= 0) state.sets[state.index] = set;
      else {
        state.sets.push(set);
        state.index = state.sets.length - 1;
      }
      select(state.index);
      $("paste").value = "";
      toast("反映しました");
    } catch (err) {
      toast(`JSONを解析できません: ${err.message}`);
    }
  });

  select(-1);
}

init();
