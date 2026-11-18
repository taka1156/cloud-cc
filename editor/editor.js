import { loadServices, loadBundledSets, parseProblemFile, download, h } from "../js/data.js";
import { validateProblemSet } from "../js/schema.js";

const $ = (id) => document.getElementById(id);
const state = { services: [], sets: [], index: -1 };
const cur = () => state.sets[state.index];
const serviceIds = () => state.services.map((s) => s.id);
const nameOf = (id) => state.services.find((s) => s.id === id)?.name ?? id;
const splitList = (v, sep) => v.split(sep).map((x) => x.trim()).filter(Boolean);

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
  schemaVersion: 1,
  id: "new-problem-001",
  title: "新しい問題",
  difficulty: 1,
  tags: [],
  statement: "",
  requirements: [],
  deck: [],
  answer: { requiredServices: [], requiredFlows: [] },
  explanation: "",
});

function toast(msg) {
  $("toast").textContent = msg;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("toast").textContent = ""), 4000);
}

/** 問題セットの検証（ID重複も含む） */
function errorsOf(set) {
  const errs = validateProblemSet(set, serviceIds());
  if (state.sets.filter((s) => s.id === set.id).length > 1) errs.push("id が他の問題と重複しています");
  return errs;
}

function upsert(set) {
  const i = state.sets.findIndex((s) => s.id === set.id);
  if (i >= 0) state.sets[i] = set;
  else state.sets.push(set);
}

function select(i) {
  state.index = i;
  fillForm(cur());
  renderList();
}

/** 一覧・フォーム・プレビュー・検証を現在の状態から描き直す */
function commit() {
  renderGrids();
  renderFlows();
  renderList();
  renderPreview();
}

function fillForm(set) {
  $("form").disabled = !set;
  for (const [key, f] of Object.entries(FIELDS)) {
    $(`f-${key}`).value = set ? f.show(set[key]) : "";
  }
  renderGrids();
  renderFlows();
  renderPreview();
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

function checkGrid(container, selected, onToggle) {
  container.replaceChildren(...state.services.map((svc) => {
    const cb = h("input", { type: "checkbox" });
    cb.checked = selected.includes(svc.id);
    cb.addEventListener("change", () => onToggle(svc.id, cb.checked));
    return h("label", { class: "chk" }, cb, svc.name, h("small", {}, ` ${svc.category}`));
  }));
}

function removeRequired(set, id) {
  set.answer.requiredServices = set.answer.requiredServices.filter((x) => x !== id);
  set.answer.requiredFlows = set.answer.requiredFlows.filter(([a, b]) => a !== id && b !== id);
}

function renderGrids() {
  const set = cur();
  if (!set) {
    $("deck-grid").replaceChildren();
    $("req-grid").replaceChildren();
    return;
  }
  checkGrid($("deck-grid"), set.deck, (id, on) => {
    const s = cur();
    if (on) s.deck.push(id);
    else {
      s.deck = s.deck.filter((x) => x !== id);
      removeRequired(s, id);
    }
    commit();
  });
  checkGrid($("req-grid"), set.answer.requiredServices, (id, on) => {
    const s = cur();
    if (on) {
      if (!s.answer.requiredServices.includes(id)) s.answer.requiredServices.push(id);
      if (!s.deck.includes(id)) s.deck.push(id);
    } else {
      removeRequired(s, id);
    }
    commit();
  });
}

function renderFlows() {
  const set = cur();
  const req = set ? set.answer.requiredServices : [];
  const opts = () => req.map((id) => h("option", { value: id }, nameOf(id)));
  $("flow-from").replaceChildren(...opts());
  $("flow-to").replaceChildren(...opts());
  $("flow-list").replaceChildren(...(set?.answer.requiredFlows ?? []).map(([a, b], i) => h("li", {},
    `${nameOf(a)} → ${nameOf(b)} `,
    h("button", {
      type: "button",
      onclick: () => { cur().answer.requiredFlows.splice(i, 1); commit(); },
    }, "削除"),
  )));
}

function renderPreview() {
  const set = cur();
  $("preview").value = set ? JSON.stringify(set, null, 2) : "";
  const errs = set ? errorsOf(set) : [];
  $("errors").replaceChildren(...(set
    ? (errs.length ? errs : ["✓ 問題ありません"]).map((m) => h("li", {}, m))
    : [h("li", {}, "問題を選択してください")]));
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

async function init() {
  try {
    state.services = await loadServices("../");
  } catch (e) {
    toast(`サービスマスターを読めません: ${e.message}`);
  }
  for (const key of Object.keys(FIELDS)) $(`f-${key}`).addEventListener("input", onEdit);

  $("btn-new").addEventListener("click", () => {
    state.sets.push(blank());
    select(state.sets.length - 1);
  });

  $("btn-delete").addEventListener("click", () => {
    const s = cur();
    if (!s || !confirm(`「${s.title || s.id}」を一覧から削除しますか？`)) return;
    state.sets.splice(state.index, 1);
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
      if (state.index >= 0) state.sets[state.index] = sets[0];
      else {
        state.sets.push(sets[0]);
        state.index = state.sets.length - 1;
      }
      select(state.index);
      $("paste").value = "";
      toast("反映しました");
    } catch (err) {
      toast(`JSONを解析できません: ${err.message}`);
    }
  });

  $("flow-add").addEventListener("click", () => {
    const set = cur();
    if (!set) return;
    const a = $("flow-from").value;
    const b = $("flow-to").value;
    if (!a || !b || a === b) return toast("接続元と接続先を別々に選んでください");
    if (!set.answer.requiredFlows.some(([x, y]) => x === a && y === b)) {
      set.answer.requiredFlows.push([a, b]);
    }
    commit();
  });

  renderList();
  select(-1);
}

init();
