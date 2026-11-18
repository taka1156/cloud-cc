import {
  loadServices, loadBundledSets, loadImported, saveImported,
  mergeSets, parseProblemFile, h,
} from "./data.js";
import { validateProblemSet, evaluate } from "./schema.js";

const $ = (id) => document.getElementById(id);
const state = { services: new Map(), sets: [], set: null, selected: [], flows: [], pendingFrom: null };

const nameOf = (id) => state.services.get(id)?.name ?? id;
const flowLabel = ([a, b]) => `${nameOf(a)} → ${nameOf(b)}`;
const showStatus = (msg) => { $("status").textContent = msg; };

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
  const set = state.sets.find((s) => s.id === id) ?? state.sets[0];
  $("result").replaceChildren();
  if (!set) {
    state.set = null;
    $("problem").replaceChildren(h("p", {}, "問題セットがありません。JSONを取り込んでください。"));
    $("deck").replaceChildren();
    $("build").replaceChildren();
    $("flows").replaceChildren();
    return;
  }
  Object.assign(state, { set, selected: [], flows: [], pendingFrom: null });
  $("set-select").value = set.id;
  renderProblem();
  renderDeck();
  renderBuild();
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

function cardEl(id, extraClass, onclick) {
  const svc = state.services.get(id) ?? { name: id, category: "other", color: "#999", description: "" };
  return h("button", {
    type: "button",
    class: `card ${extraClass}`,
    style: { borderTopColor: svc.color },
    onclick,
  }, h("strong", {}, svc.name), h("small", {}, svc.category), h("span", { class: "desc" }, svc.description));
}

function renderDeck() {
  $("deck").replaceChildren(...state.set.deck.map((id) =>
    cardEl(id, state.selected.includes(id) ? "on" : "", () => toggleSelect(id))));
}

/** 山札からカードを使う/使わないを切り替える */
function toggleSelect(id) {
  if (state.selected.includes(id)) {
    state.selected = state.selected.filter((x) => x !== id);
    state.flows = state.flows.filter(([a, b]) => a !== id && b !== id);
    if (state.pendingFrom === id) state.pendingFrom = null;
  } else {
    state.selected.push(id);
  }
  renderDeck();
  renderBuild();
}

function renderBuild() {
  $("build").replaceChildren(...(state.selected.length
    ? state.selected.map((id) => cardEl(id, state.pendingFrom === id ? "pending" : "", () => clickBuild(id)))
    : [h("p", { class: "meta" }, "山札からカードを選んでください")]));

  $("flows").replaceChildren(...state.flows.map(([a, b], i) => h("li", {},
    `${flowLabel([a, b])} `,
    h("button", { type: "button", onclick: () => { state.flows.splice(i, 1); renderBuild(); } }, "削除"),
  )));

  $("connect-hint").textContent = state.pendingFrom
    ? `接続元: ${nameOf(state.pendingFrom)}。接続先のカードをクリック（同じカードでキャンセル）`
    : "接続元のカードをクリックし、次に接続先のカードをクリック";
}

/** 構成エリアのカードをクリックして接続を作る */
function clickBuild(id) {
  if (!state.pendingFrom) {
    state.pendingFrom = id;
  } else if (state.pendingFrom === id) {
    state.pendingFrom = null;
  } else {
    const from = state.pendingFrom;
    if (!state.flows.some(([a, b]) => a === from && b === id)) state.flows.push([from, id]);
    state.pendingFrom = null;
  }
  renderBuild();
}

function judge() {
  const s = state.set;
  if (!s) return;
  if (!state.selected.length) {
    $("result").replaceChildren(h("p", { class: "meta" }, "カードを1枚以上選んでから判定してください"));
    return;
  }
  const r = evaluate(s, state.selected, state.flows);
  const ans = s.answer;
  $("result").replaceChildren(
    h("div", { class: `verdict ${r.passed ? "pass" : "fail"}` },
      `${r.passed ? "合格" : "不合格"}　一致率 ${r.score}%`),
    r.missingServices.length
      ? h("p", {}, `不足しているサービス: ${r.missingServices.map(nameOf).join(", ")}`) : null,
    r.missingFlows.length
      ? h("p", {}, `不足している接続: ${r.missingFlows.map(flowLabel).join(", ")}`) : null,
    r.extra.length
      ? h("p", { class: "meta" }, `余分なカード（減点なし）: ${r.extra.map(nameOf).join(", ")}`) : null,
    h("h3", {}, "模範解答"),
    h("p", {}, `必須サービス: ${ans.requiredServices.map(nameOf).join(", ")}`),
    h("p", {}, `接続: ${(ans.requiredFlows ?? []).map(flowLabel).join(", ") || "なし"}`),
    h("h3", {}, "解説"),
    h("p", { class: "statement" }, s.explanation),
  );
}

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
