# cloud-cc

AWSの構成図の枠に、山札のサービスカードを置いて完成させるゲームのPoCです。ビルドなしの静的サイト（HTML / CSS / ES Modules）として動きます。

## 遊び方

1. 問題を選ぶと、構成図（Region・AZ などのゾーン、枠、線）と山札が表示されます。
2. 山札のカードを枠へドラッグします。クリックすると、置ける空き枠に自動で入ります。
3. カードごとに置ける枠が決まっています。ドラッグ中は置けない枠が暗くなり、置こうとすると理由が表示されます。
4. 置いたカードはドラッグで別の枠へ移動でき、山札へ戻すと外れます。
5. 「判定する」で、正解の枠に正しいカードが置けているかを判定し、模範解答と解説を表示します。

## 起動

```bash
npm run serve          # http://localhost:8000 で起動（python3 -m http.server）
```

- ゲーム: `http://localhost:8000/`
- 作問エディター: `http://localhost:8000/editor/`

`fetch` でJSONを読むため、`file://` で直接開くとデータが読めません。HTTP サーバー経由か GitHub Pages で開いてください。

## データ

| 種類 | 場所 | 扱い |
|---|---|---|
| サービスカード | `data/services.json` | 固定のマスター。置ける枠と組み合わせのルールをカード側に持つ |
| 構成図テンプレート | `data/templates/<id>.json` | 枠の位置・種類と、Region/AZ などのゾーン |
| 問題セット | `data/problems/<id>.json` | 問題文・山札・正解・解説のまとまり。追加・書き出し・取り込みが自由 |

### サービスカード（カード側のルール）

```json
{ "id": "waf", "name": "WAF", "category": "security", "color": "#DD344C",
  "description": "Webアプリへの攻撃を防御", "placeableIn": ["edge", "lb", "api"] }
```

- `placeableIn`: 置ける枠の種類。枠の `kind` がここに無いと置けません（例: WAF は「権限・鍵」の枠には置けない）。
- `cannotWith`: 盤面で一緒に使えないサービス（例: Auto Scaling と Lambda）。どちらか一方に書けば両方向に効きます。
- `icon`（任意）: アイコン画像のパス。
- 枠の種類は `js/schema.js` の `KINDS` にあります（`edge` / `lb` / `api` / `compute` / `data` / `storage` / `messaging` / `network` / `security` / `ops` / `devops` / `ai`）。

### 構成図テンプレート

盤面は 960×520 の論理座標で、枠1つは 120×88 です。

```json
{
  "schemaVersion": 1, "id": "three-tier", "name": "3層・2AZ構成",
  "width": 960, "height": 520,
  "zones": [{ "label": "AZ-a", "x": 60, "y": 170, "w": 340, "h": 300 }],
  "slots": [{ "id": "app1", "kind": "compute", "label": "アプリ（AZ-a）", "x": 120, "y": 220 }]
}
```

同梱のテンプレート: `edge-web`（静的サイト配信）、`three-tier`（3層・2AZ）、`serverless`（サーバーレスAPI）、`pipeline`（デプロイパイプライン）、`ai-app`（AIアプリ）。

### 問題セット

```json
{
  "schemaVersion": 2,
  "id": "web-3tier-002",
  "title": "3層構造のWebアプリ",
  "difficulty": 2,
  "tags": ["3層"],
  "statement": "問題文",
  "requirements": ["要件1", "要件2"],
  "template": "three-tier",
  "deck": ["route53", "alb", "ec2", "ec2", "rds", "s3"],
  "answer": { "slots": { "dns": "route53", "lb": "alb", "app1": "ec2", "app2": "ec2", "db1": "rds" } },
  "links": [["dns", "lb"], ["lb", "app1"], ["lb", "app2"], ["app1", "db1"]],
  "explanation": "解説"
}
```

- `deck`: 山札。同じカードを複数枚入れられます（2つのAZの EC2 など）。
- `answer.slots`: 枠ID → 正解のサービスID。盤面にはここに書いた枠だけが表示され、プレイヤーはそのすべてを埋めます（テンプレートの他の枠は出ません）。
- `links`: 構成図に最初から描く線（正解で使う枠IDの組・向きなし）。プレイヤーは線を引きません。

サンプルとして、クラウドプラクティショナー・ソリューションアーキテクト・DevOps・AIプラクティショナーの各5問と、入門用の3問が入っています。

## 問題の追加方法

### A. JSONを直接置く

1. `data/problems/` に `<id>.json` を作る（分類ごとに配列でまとめてもよい）
2. `npm run build` で検証し、`index.json` を更新する

### B. 作問エディターを使う

1. `http://localhost:8000/editor/` を開く
2. テンプレートを選び、山札の枚数、枠ごとの正解、描く線を設定する。正解のプルダウンには、その枠に置けるカードだけが出ます
3. 「この問題を書き出し」で保存したJSONを `data/problems/` に置き、`npm run build` を実行する

### C. AIに作ってもらう

`.claude/skills/author-problem/SKILL.md` に作問手順と形式をまとめています。Claude Code で「問題を作って（テーマ：〇〇、難易度2）」と頼むと、このスキルに沿って作成と検証まで行います。エディターの「JSONを貼り付けて反映」を使えば、AIが出したJSONを画面で確認できます。

### ゲーム画面からの取り込み

ゲームの「JSON取り込み」で読んだ問題は、検証が通ればブラウザに保存されます（この端末のみ）。リポジトリに残す問題は `data/problems/` に置いてください。

## AWSアイコン

SVG を `assets/aws/` に置き、`data/services.json` の該当サービスに `"icon": "assets/aws/ec2.svg"` のように書くと、カードに表示されます。`icon` が無いサービスはサービス色のバッジで表示します。詳しくは `assets/aws/README.txt` を見てください。

## コマンド

```bash
npm run build   # 検証 + data/templates/index.json と data/problems/index.json を更新
npm run check   # 検証のみ
npm run dist    # 公開用の dist/ を作成（ブラウザに必要なファイルだけ）
```

## 公開（GitHub Pages）

`main` に push すると、GitHub Actions が検証して `dist/` を作り、`dist` ブランチへ反映します（`.github/workflows/dist-branch.yml`）。Pages は「Deploy from a branch: `dist` / (root)」で配信します。スキルやスクリプトは配信されません。

## ディレクトリ構成

```
index.html              ゲーム画面
editor/                 作問エディター
css/style.css           共通スタイル
js/schema.js            検証・判定ロジック（ブラウザとNode.jsで共用）
js/data.js              読込・取り込み・書き出しの共通処理
js/game.js              ゲームのロジック
data/services.json      サービスカードのマスター
data/templates/         構成図テンプレート
data/problems/          問題セット
assets/aws/             AWSアイコン（任意）
scripts/build.mjs       検証と index.json の生成
scripts/dist.mjs        公開用 dist/ の作成
.claude/skills/author-problem/SKILL.md   AI作問用スキル
```

## PoCの範囲

- 対戦モード（カードの横取りと、それを防ぐ IAM・WAF などの効果）はありません。配置の正しさだけを判定します。
- 判定は「表示された枠すべてに正しいカードがあるか」で行います。
