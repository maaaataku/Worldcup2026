# SAMURAI BLUE ダッシュボード｜FIFA World Cup 2026

FIFA ワールドカップ2026・日本代表（SAMURAI BLUE）を追う **自動更新ダッシュボード**です。
見た目は単一HTMLの完成版デザインをそのまま使い、データだけを外部APIから毎日自動取得します。

- 公開ページ: **`index.html`**（`data/wc2026.json` を `fetch` して描画）
- デザイン原本: `worldcup2026-japan-dashboard.html`（無改変で保存。差分比較用）

---

## 仕組み（データフロー）

```
                    ┌─────────────────────┐
   football-data.org│  scripts/update.mjs │  ← 毎日 09:00 JST (GitHub Actions)
   / API-Football ─▶│  取得→マップ→merge  │
                    └──────────┬──────────┘
   data/static.json ──────────▶│  （手管理データ）
   （前回の wc2026.json）──────▶│  （フォールバック源）
                               ▼
                       data/wc2026.json  ──fetch──▶  index.html（描画）
```

- **API から取得**: ①日本の次戦/日程・結果　②グループF順位表（試合数・勝分敗・得失点）　③決勝T組み合わせ　④大会フェーズ進行
- **`data/static.json` で手管理**（APIに無い項目）: 予想スタメンの座標 `lineups`、登録26名の背番号/所属/年齢、対戦国スカウティング文、`nedKey`（警戒選手）、全12組のドロー、放送/会場、ノックアウトのテンプレート 等
- **フォールバック**: 取得失敗・レート制限・キー未設定でも、前回の `data/wc2026.json` を保持するので画面は壊れません。

---

## ディレクトリ構成

```
.
├─ index.html                 公開ページ（fetch して描画）
├─ worldcup2026-japan-dashboard.html  デザイン原本（無改変）
├─ data/
│  ├─ static.json             手管理データ＋名称マッピング＋ノックアウトテンプレ＋seed
│  └─ wc2026.json             生成物。画面が読む唯一のデータ＝フォールバック源（必ずコミット）
├─ scripts/
│  ├─ update.mjs              取得→マップ→merge→書き出し（エントリ）
│  ├─ lib.mjs                 共通（fetch リトライ・JST 日付整形）
│  └─ providers/
│     ├─ api-football.mjs     API-Football(api-sports.io) アダプタ
│     └─ football-data.mjs    football-data.org アダプタ
├─ .github/workflows/update.yml   毎日 09:00 JST＋手動実行
├─ .env.example
└─ package.json               依存ゼロ（Node18+ の標準 fetch を使用）
```

---

## セットアップ手順

### 1. APIキーを取得する

どちらか一方でOK（`update.mjs` は両対応）。**推奨は API-Football**（無料枠で WC2026 のカバレッジが安定）。

| プロバイダ | 取得先 | 無料枠 | 既定の対象 |
|---|---|---|---|
| **API-Football**（推奨） | <https://www.api-football.com/>（api-sports.io に登録 → Dashboard の API Key） | 100リクエスト/日 | `league=1, season=2026` |
| football-data.org | <https://www.football-data.org/client/register> | 10リクエスト/分 | `competition=WC` |

> RapidAPI 経由のキーを使う場合は `FOOTBALL_API_BASE` とヘッダ仕様が異なります。まずは各社の直URL（既定値）での利用を推奨します。

### 2. `.env` を設定する

```bash
cp .env.example .env
```

`.env` を開いて編集（`.env` は `.gitignore` 済み。コミットされません）:

```dotenv
FOOTBALL_API_PROVIDER=api-football   # または football-data
FOOTBALL_API_KEY=取得したキー
```

### 3. データ取得をローカル実行する

```bash
node scripts/update.mjs
# または
npm run update
```

成功すると `data/wc2026.json` が更新されます。
キー未設定・取得失敗時は前回値を保持して終了します（画面は壊れません）。

### 4. ローカルで表示確認する

`index.html` は `fetch` を使うため、`file://` ではなく **HTTPサーバ経由**で開きます。

```bash
npm run serve
# 内部で `npx serve` を起動。表示された http://localhost:5000 をブラウザで開く
```

`npx serve` を使わない場合の代替:

```bash
python3 -m http.server 5000      # → http://localhost:5000
```

### 5. GitHub Pages で公開する

1. リポジトリを GitHub に push。
2. **Settings → Secrets and variables → Actions**
   - **Secrets** に `FOOTBALL_API_KEY` を追加。
   - （任意）**Variables** に `FOOTBALL_API_PROVIDER`（`api-football` / `football-data`）。未設定なら `api-football`。
3. **Settings → Pages** で **Source = Deploy from a branch**、**Branch = `main` / `(root)`** を選択して保存。
4. **Settings → Actions → General → Workflow permissions** を **Read and write permissions** に設定（ボットが `data/wc2026.json` をコミットできるように）。
5. これで毎日 **09:00 JST** に `update.mjs` が走り、差分があれば自動コミット → Pages に反映されます。
   - 手動で動かすには **Actions → Update WC2026 data → Run workflow**（`workflow_dispatch`）。

公開URLは `https://<ユーザー名>.github.io/<リポジトリ名>/` です。

---

## 手管理データの更新（`data/static.json`）

APIに無い・自分の言葉で書く部分はここを編集します。編集後はローカルで `node scripts/update.mjs` を実行すると `wc2026.json` に反映されます。

- `lineups.jp` / `lineups.ned` … 予想スタメンの選手と **ピッチ座標 `x,y`（%）**
- `squad` / `nedSquad` … 登録26名（背番号・所属・年齢・`cap`/`in`/`out` フラグ）
- `squadNote` / `nedNote` … 注記（HTML可）
- `opponents` / `nedKey` … 対戦国スカウティング文・警戒選手
- `groups` … 全12組のドロー（空欄は `["",""]`）
- `teamNames` / `tlaNames` … APIの英語名・TLA → 日本語（未登録は英語名のまま表示）
- `teamMeta` … スコアボードの「FIFA◯位・ポット◯」表記
- `matchInfo` … 各節の会場・放送（API英語会場名ではなく日本語表記を使う）
- `knockoutTemplate` … ノックアウトのテンプレート（下記）

### ノックアウト解決ロジック

`update.mjs` は **F組での日本の最終順位**に応じて `knockoutTemplate` を選びます。

- `"1"`（1位通過）= デザイン原本の最短ルート。設定済み。
- `"2"`（2位通過）/ `"3"`（3位＝成績上位）= **編集用スケルトン**。`tbd:true` が付いています。
  FIFA 公式ブラケットで確定した試合番号・対戦組を入れて書き換えてください。
- グループステージが3試合とも消化されるまでは `"1"`（1位想定）の最短ルートを表示します（原本の挙動を維持）。
- 他組が全消化されると、ブラケット内の `C組2位` などのトークンを **実チーム名**へ自動置換します。

---

## 手動運用（フォールバックモード）

ライブ取得を使わない／使えない場合（例: API-Football 無料プランは2026シーズン非対応）でも、
手編集だけで運用できます。**どのファイルを編集するかが鍵**です。

| 更新したいもの | 編集先 | 補足 |
|---|---|---|
| 試合結果・スコア・順位表・次戦・ブラケット | **`data/wc2026.json`**（画面が読む本体） | この4種（`groupF` / `schedule` / `nextMatch` / `bracket`）は「API由来フィールド」。手動時はこのファイルを直接編集する |
| 予想スタメン・26名・スカウティング文・全12組・注記 | **`data/static.json`** | 記述系の手管理データ。`npm run update` で `wc2026.json` に反映される |
| 大会フェーズの「現在 ●」表示 | 自動 | 今日の日付から計算（編集不要） |

- 手動で結果を入れる例（`data/wc2026.json`）:
  - `groupF[].p/w/d/l/gf/ga` を更新（順位は画面側が勝点→得失→得点で自動ソート）
  - `schedule.group[].score`（例 `"2–1"`）と `result`（`"win"`/`"loss"`/`"draw"`/`"next"`）
  - `nextMatch` を次の試合へ書き換え
- 編集後は `git add -A && git commit && git push`。GitHub Pages に反映されます。
- `npm run update` を流しても、API由来フィールドは前回の `wc2026.json` を引き継ぐため**手編集は消えません**（記述系は `static.json` が正）。
- 後日、2026に対応したキー（API-Football 有料 or football-data.org）を `.env`／Secrets に入れれば、そのまま自動取得に切り替わります。

---

## トラブルシュート

- **画面が「読み込み失敗」**: `data/wc2026.json` が配信されているか確認（`fetch('./data/wc2026.json')`）。`file://` では動きません。HTTPサーバ経由で開いてください。
- **データが古いまま**: Actions のログを確認。`FOOTBALL_API_KEY` 未設定／レート超過の場合はフォールバックで前回値を保持します（壊れはしません）。
- **チーム名が英語のまま**: `static.json` の `teamNames` / `tlaNames` に対応を追記してください。
- **無料枠が WC2026 を返さない（football-data.org）**: API-Football へ切替（`FOOTBALL_API_PROVIDER=api-football`）を検討してください。

---

2026年6月時点の公開情報に基づく非公式まとめ。最新の確定情報は JFA / FIFA 公式でご確認ください。
