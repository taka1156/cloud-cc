// 問題セットの検証と判定ロジック（ブラウザ・Node.js 共用）

export const CATEGORIES = [
  "compute", "storage", "database", "network",
  "security", "monitoring", "integration", "other",
];

/**
 * 問題セット1件を検証し、エラーメッセージの配列を返す（空なら合格）。
 * @param {object} set 問題セット
 * @param {string[]} serviceIds services.json に存在するサービスID一覧
 */
export function validateProblemSet(set, serviceIds) {
  const errors = [];
  if (!set || typeof set !== "object" || Array.isArray(set)) {
    return ["問題セットはオブジェクトである必要があります"];
  }
  const known = new Set(serviceIds);
  const check = (ok, msg) => { if (!ok) errors.push(msg); };

  check(typeof set.id === "string" && /^[a-z0-9][a-z0-9-]*$/.test(set.id),
    "id は小文字英数字とハイフンのみ使用できます");
  check(typeof set.title === "string" && set.title.trim() !== "", "title が必要です");
  check([1, 2, 3].includes(set.difficulty), "difficulty は 1〜3 の整数です");
  check(set.tags === undefined || Array.isArray(set.tags), "tags は配列です");
  check(typeof set.statement === "string" && set.statement.trim() !== "",
    "statement（問題文）が必要です");
  check(Array.isArray(set.requirements), "requirements は配列です");
  check(typeof set.explanation === "string", "explanation（解説）が必要です");

  const deck = Array.isArray(set.deck) ? set.deck : [];
  check(deck.length > 0, "deck（山札）は1枚以上必要です");
  check(new Set(deck).size === deck.length, "deck に同じサービスが重複しています");
  deck.forEach((id) => check(known.has(id), `deck: 未知のサービスID "${id}"`));

  const ans = set.answer ?? {};
  const req = Array.isArray(ans.requiredServices) ? ans.requiredServices : [];
  const flows = Array.isArray(ans.requiredFlows) ? ans.requiredFlows : [];
  check(req.length > 0, "answer.requiredServices は1つ以上必要です");
  req.forEach((id) => {
    check(known.has(id), `answer: 未知のサービスID "${id}"`);
    check(deck.includes(id), `answer の "${id}" が deck に含まれていません`);
  });
  flows.forEach((f) => {
    const ok = Array.isArray(f) && f.length === 2 && f[0] !== f[1]
      && f.every((x) => req.includes(x));
    check(ok, `answer.requiredFlows は requiredServices 内の異なる2つのIDの組です: ${JSON.stringify(f)}`);
  });
  return errors;
}

/**
 * プレイヤーの構成を正解と比較する。
 * @param {object} set 問題セット
 * @param {string[]} selected 選んだサービスID
 * @param {string[][]} flows 引いた接続 [元, 先]
 */
export function evaluate(set, selected, flows) {
  const req = set.answer.requiredServices;
  const reqFlows = set.answer.requiredFlows ?? [];
  const sel = new Set(selected);
  const key = (a, b) => `${a}>${b}`;
  const built = new Set(flows.map(([a, b]) => key(a, b)));

  const missingServices = req.filter((id) => !sel.has(id));
  const missingFlows = reqFlows.filter(([a, b]) => !built.has(key(a, b)));
  const extra = selected.filter((id) => !req.includes(id));

  const total = req.length + reqFlows.length;
  const hit = total - missingServices.length - missingFlows.length;
  return {
    score: Math.round((hit / total) * 100),
    passed: missingServices.length === 0 && missingFlows.length === 0,
    missingServices,
    missingFlows,
    extra,
  };
}
