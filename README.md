# cloud-cc

AWSのサービスカードを山札から選び、要件に合う構成を組み立てる構成ゲームのPoCです。ビルドなしの静的サイト（HTML / CSS / ES Modules）として動きます。

## 起動

```bash
npm run serve          # http://localhost:8000 で起動（python3 -m http.server）
```

- ゲーム: `http://localhost:8000/`
- 作問エディター: `http://localhost:8000/editor/`

`fetch` でJSONを読むため、`file://` で直接開くとデータが読めません。必ず HTTP サーバー経由で開いてください。

## データの置き場所

データは2種類あり、扱いが異なります。

| 種類 | 場所 | 扱い |
|---|---|---|
| サービスカード（マスター） | `data/services.json` | 固定値。リポジトリで管理し、直接編集する |
| 問題セット | `data/problems/<id>.json` | 1問題1ファイル。追加・差し替えが自由。ゲームやエディターから書き出し・取り込みもできる |

### 問題セットの構造

1つの問題セットは「問題文・山札・正解・解説」をまとめたものです。

```json
{
  "schemaVersion": 1,
  "id": "web-3tier-002",
  "title": "3層構造のWebアプリ",
  "difficulty": 2,
  "tags": ["3層", "EC2"],
  "statement": "問題文",
  "requirements": ["要件1", "要件2"],
  "deck": ["route53", "alb", "ec2", "rds", "s3"],
  "answer": {
    "requiredServices": ["route53", "alb", "ec2", "rds"],
    "requiredFlows": [["route53", "alb"], ["alb", "ec2"], ["ec2", "rds"]]
  },
  "explanation": "解説"
}
```

- `deck` は山札に出すサービスID（`services.json` の `id`）
- `answer.requiredServices` は必ず入れるべきサービス（`deck` に含まれている必要あり）
- `answer.requiredFlows` は必要な接続 `[元, 先]`
- `deck` のうち正解に含まれないものは「余分なカード」として扱われ、減点はしません

## 問題の追加方法

### A. JSONを直接置く（一番確実）

1. `data/problems/` に `<id>.json` を作る
2. `npm run build` で検証し、`data/problems/index.json` を更新する
3. 検証エラーが出たら、表示された箇所を直して再実行する

### B. 作問エディターを使う

1. `http://localhost:8000/editor/` を開く
2. 「新規作成」かフォームで問題を入力する。山札・必須サービス・接続はチェックボックスとプルダウンで選べる
3. 「この問題を書き出し」で `<id>.json` を保存し、`data/problems/` に置く
4. `npm run build` を実行する

既存の問題は「リポジトリの問題を読込」で編集できます。複数問題をまとめて「全件を書き出し」すると配列のJSONになり、「JSON読込」で一括取り込みできます。

### C. AIに作ってもらう

`.claude/skills/author-problem/SKILL.md` に作問手順と形式をまとめています。Claude Code で「問題を作って（テーマ：〇〇、難易度2）」と頼めば、このスキルに従って `data/problems/` にファイルを作り、検証まで行います。エディターの「JSONを貼り付けて反映」を使えば、AIが出力したJSONを画面で確認してから保存できます。

### ゲーム画面からの取り込み

ゲームの「JSON取り込み」で `.json` を選ぶと、検証が通った問題だけがブラウザに保存されます（この端末のみ・リポジトリには反映されません）。リポジトリに残したい問題は `data/problems/` に置いてください。

## サービスカードの追加

`data/services.json` の `services` に次の形式で追加します。

```json
{ "id": "xxx", "name": "表示名", "category": "compute", "color": "#ED7100", "description": "一言説明" }
```

`category` は `compute` / `storage` / `database` / `network` / `security` / `monitoring` / `integration` / `other` のいずれか。追加後は問題側の `deck` などから参照できます。

## 検証コマンド

```bash
npm run build   # 検証 + data/problems/index.json を更新
npm run check   # 検証のみ
```

## ディレクトリ構成

```
index.html              ゲーム画面
editor/                 作問エディター
css/style.css           共通スタイル
js/schema.js            検証・判定ロジック（ブラウザとNode.jsで共用）
js/data.js              読込・取り込み・書き出しの共通処理
js/game.js              ゲームのロジック
data/services.json      サービスカードのマスター（固定値）
data/problems/          問題セット（1問題1ファイル）
scripts/build.mjs       検証と index.json の生成
.claude/skills/author-problem/SKILL.md   AI作問用スキル
```

## PoCの範囲と今後

- 接続は「カードを2つクリックして線を引く」簡易UIです。図としての線描画は未対応です。
- 判定は「必須サービスの有無」と「必須接続の有無」だけで行います。接続の向きや冗長性の評価は未対応です。
- 問題の共有・ランキング・ユーザー管理はありません。
