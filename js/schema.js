// 問題・テンプレート・サービスの検証と判定ロジック（ブラウザ・Node.js 共用）

/** 枠の種類。サービス側の placeableIn と照合する */
export const KINDS = [
  "edge", "lb", "api", "compute", "data", "storage", "messaging",
  "network", "security", "ops", "devops", "ai",
];

export const KIND_LABELS = {
  edge: "エッジ", lb: "ロードバランサー", api: "API入口", compute: "計算",
  data: "データベース", storage: "ストレージ", messaging: "メッセージ",
  network: "ネットワーク", security: "セキュリティ", ops: "監視・運用",
  devops: "開発・デプロイ", ai: "AI",
};

/** 枠1つの大きさ（盤面の論理座標 px） */
export const SLOT_W = 120;
export const SLOT_H = 88;

/** 線の組を向きなしのキーにする（[A,B] と [B,A] は同じ線） */
export const linkKey = (a, b) => [a, b].sort().join("|");

/** 2つのサービスが一緒には使えないか（どちら側の指定でも対象） */
export function conflictsWith(a, b) {
  return (a.cannotWith ?? []).includes(b.id) || (b.cannotWith ?? []).includes(a.id);
}

/** 盤面テンプレート1件の検証 */
export function validateTemplate(t) {
  const errors = [];
  const check = (ok, msg) => { if (!ok) errors.push(msg); };
  if (!t || typeof t !== "object" || Array.isArray(t)) return ["テンプレートはオブジェクトです"];

  check(typeof t.id === "string" && /^[a-z0-9][a-z0-9-]*$/.test(t.id), "id は小文字英数字とハイフンのみです");
  check(typeof t.name === "string" && t.name.trim() !== "", "name が必要です");
  check(Number.isFinite(t.width) && Number.isFinite(t.height) && t.width > 0 && t.height > 0,
    "width / height が必要です");
  check(Array.isArray(t.zones), "zones は配列です");
  check(Array.isArray(t.slots) && t.slots.length > 0, "slots は1つ以上必要です");

  const ids = new Set();
  (t.slots ?? []).forEach((s) => {
    check(typeof s.id === "string" && s.id !== "", "slot.id が必要です");
    check(!ids.has(s.id), `slot.id が重複しています: ${s.id}`);
    ids.add(s.id);
    check(KINDS.includes(s.kind), `slot "${s.id}" の kind が不明です: ${s.kind}`);
    check(typeof s.label === "string" && s.label !== "", `slot "${s.id}" の label が必要です`);
    const inside = Number.isFinite(s.x) && Number.isFinite(s.y)
      && s.x >= 0 && s.y >= 0 && s.x + SLOT_W <= t.width && s.y + SLOT_H <= t.height;
    check(inside, `slot "${s.id}" が盤面からはみ出しています`);
    // 縦長の画面では x と y を入れ替えて描くので、入れ替えても収まること
    const cx = s.x + SLOT_W / 2;
    const cy = s.y + SLOT_H / 2;
    const insidePortrait = cy - SLOT_W / 2 >= 0 && cy + SLOT_W / 2 <= t.height
      && cx - SLOT_H / 2 >= 0 && cx + SLOT_H / 2 <= t.width;
    check(insidePortrait, `slot "${s.id}" が縦向き表示ではみ出します（上下の端に寄せすぎ）`);
  });
  return errors;
}

/**
 * 問題セット1件を検証する。
 * @param {object} set 問題セット
 * @param {{services: Map<string, object>, templates: Map<string, object>}} ctx
 */
export function validateProblemSet(set, ctx) {
  const errors = [];
  const check = (ok, msg) => { if (!ok) errors.push(msg); };
  if (!set || typeof set !== "object" || Array.isArray(set)) {
    return ["問題セットはオブジェクトである必要があります"];
  }

  check(set.schemaVersion === 2, "schemaVersion は 2 です");
  check(typeof set.id === "string" && /^[a-z0-9][a-z0-9-]*$/.test(set.id),
    "id は小文字英数字とハイフンのみ使用できます");
  check(typeof set.title === "string" && set.title.trim() !== "", "title が必要です");
  check([1, 2, 3].includes(set.difficulty), "difficulty は 1〜3 の整数です");
  check(set.tags === undefined || Array.isArray(set.tags), "tags は配列です");
  check(typeof set.statement === "string" && set.statement.trim() !== "", "statement（問題文）が必要です");
  check(Array.isArray(set.requirements), "requirements は配列です");
  check(typeof set.explanation === "string", "explanation（解説）が必要です");

  const tpl = ctx.templates.get(set.template);
  check(!!tpl, `template が見つかりません: ${set.template}`);

  const deck = Array.isArray(set.deck) ? set.deck : [];
  check(deck.length > 0, "deck（山札）は1枚以上必要です");
  deck.forEach((id) => check(ctx.services.has(id), `deck: 未知のサービスID "${id}"`));

  if (!tpl) return errors;
  const slots = new Map(tpl.slots.map((s) => [s.id, s]));

  // 正解：枠ごとのサービス
  const answer = set.answer?.slots ?? {};
  const answerEntries = Object.entries(answer);
  check(answerEntries.length > 0, "answer.slots は1つ以上必要です");
  const used = {};
  answerEntries.forEach(([slotId, svcId]) => {
    const slot = slots.get(slotId);
    check(!!slot, `answer: テンプレートにない枠 "${slotId}"`);
    const svc = ctx.services.get(svcId);
    check(!!svc, `answer: 未知のサービス "${svcId}"`);
    if (slot && svc) {
      check(svc.placeableIn.includes(slot.kind),
        `answer: "${svcId}" は枠 "${slotId}"（${slot.kind}）には置けません`);
      used[svcId] = (used[svcId] ?? 0) + 1;
    }
  });
  Object.entries(used).forEach(([svcId, n]) => {
    const have = deck.filter((x) => x === svcId).length;
    check(n <= have, `answer で "${svcId}" を${n}枚使いますが、山札には${have}枚しかありません`);
  });
  const answerSvcs = answerEntries.map(([, svcId]) => ctx.services.get(svcId)).filter(Boolean);
  answerSvcs.forEach((a, i) => answerSvcs.slice(i + 1).forEach((b) => {
    check(!conflictsWith(a, b), `answer: "${a.id}" と "${b.id}" は一緒には使えません`);
  }));

  // 固定の線（枠どうしを結ぶ・向きなし）
  const links = Array.isArray(set.links) ? set.links : [];
  const seen = new Set();
  // 盤面には正解で使う枠だけが出るので、線もその枠どうしに限る
  links.forEach((l) => {
    const ok = Array.isArray(l) && l.length === 2 && l[0] !== l[1]
      && l.every((id) => slots.has(id) && id in answer);
    check(ok, `links は正解で使う枠の異なる2つの組です: ${JSON.stringify(l)}`);
    if (ok) {
      const k = linkKey(l[0], l[1]);
      check(!seen.has(k), `links に同じ線が重複しています: ${JSON.stringify(l)}`);
      seen.add(k);
    }
  });
  return errors;
}

/**
 * プレイヤーの配置を正解と比べる。
 * @param {object} set 問題セット
 * @param {Record<string, string>} placedBySlot 枠ID → 置いたサービスID
 */
export function evaluate(set, placedBySlot) {
  const answer = set.answer.slots;
  const slotIds = Object.keys(answer);
  const correct = slotIds.filter((s) => placedBySlot[s] === answer[s]);
  const missing = slotIds.filter((s) => !correct.includes(s));
  const extra = Object.keys(placedBySlot).filter((s) => !(s in answer));
  return {
    score: Math.round((correct.length / slotIds.length) * 100),
    passed: missing.length === 0,
    correct,
    missing,
    extra,
  };
}
