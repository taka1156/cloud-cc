---
name: author-problem
description: cloud-cc の AWS構成ゲームの問題セット（問題文・山札・正解・解説）をJSONで新規作成・修正するときに使う。「問題を作って」「山札を追加」「問題を増やして」などの依頼で使用する。
---

# cloud-cc 問題作成スキル

問題セットは `data/problems/<id>.json` に1問題1ファイルで置く。サービスカードは `data/services.json` の固定マスターからのみ選ぶ。

## 手順

1. `data/services.json` を読み、使えるサービスIDを確認する。存在しないサービスは勝手に追加せず、必要ならユーザーに確認する。
2. 既存の `data/problems/` を一覧し、同じ題材や `id` が重複しないことを確かめる。
3. 次の形式で `data/problems/<id>.json` を作る。`id` は小文字英数字とハイフンのみ。
4. 作成後 `node scripts/build.mjs` で検証する。エラーが出たら修正して再実行する。
5. 完了報告では、作成したファイルパス、山札の枚数、必須サービス、検証結果を短く伝える。

## 形式

```json
{
  "schemaVersion": 1,
  "id": "web-3tier-002",
  "title": "3層構造のWebアプリ",
  "difficulty": 2,
  "tags": ["3層", "EC2"],
  "statement": "問題文（プレイヤーに見せる状況説明）",
  "requirements": ["要件1", "要件2"],
  "deck": ["route53", "alb", "ec2", "rds", "s3"],
  "answer": {
    "requiredServices": ["route53", "alb", "ec2", "rds"],
    "requiredFlows": [["route53", "alb"], ["alb", "ec2"], ["ec2", "rds"]]
  },
  "explanation": "解説"
}
```

## 作問のルール

- `difficulty` は 1（サービス2〜3個の入門）、2（4〜5個の標準）、3（6個以上や冗長化・セキュリティ要件を含む応用）の目安で決める。
- `deck` は正解に必要なサービスに、ダミーを 2〜4 枚加えて作る。ダミーは「要件に合わないが一見使えそう」なものにすると良い。
- `answer.requiredServices` はすべて `deck` に含める。
- `answer.requiredFlows` は `requiredServices` 内の、異なる2つのIDの組だけで作る。線は向きがないので、`["a","b"]` と `["b","a"]` は同じ線であり、両方書いてはいけない（重複はエラー）。
- `requirements` は、正解を一意に絞れる程度に具体的に書く。
- `explanation` には「なぜこの構成か」と「ダミーが不要な理由」を書く。
- 問題文・要件・解説は日本語で書く。

## 検証でよくあるエラー

- `deck に未知のサービスID`: `services.json` にないIDを使っている。
- `answer の "x" が deck に含まれていません`: 必須サービスを山札に入れ忘れている。
- `requiredFlows` の要素エラー: 組に `requiredServices` 以外のIDが入っているか、同じIDを2回書いている。
- `id が ... と重複`: 別ファイルに同じ `id` がある。
