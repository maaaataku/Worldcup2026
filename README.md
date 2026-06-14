# SAMURAI BLUE ダッシュボード｜FIFA World Cup 2026

FIFA ワールドカップ2026・日本代表（SAMURAI BLUE）ダッシュボード。
見た目は単一HTMLの完成版デザインをそのまま使い、データを外部ソースから取得して
`data/wc2026.json` に書き出します。**更新は定期実行（cron）ではなく、必要なときにオンデマンドで実行**します。

- 公開ページ: **`index.html`**（`data/wc2026.json` を `fetch` して描画）
- デザイン原本: `worldcup2026-japan-dashboard.html`（無改変で保存。差分比較用）

> **運用モデル**: 定期実行ルーティンは持ちません。予想スタメンやスカウティング文など「書く」領域があり、
> 半自動だと中途半端になるため、**更新したいタイミングで手動／このセッションで Claude に依頼**して更新します。

---

## 仕組み（データフロー）

```
   ESPN（無料・キー不要）─▶┐
                          │  scripts/update.mjs
   data/static.json ──────┼─▶  取得→マップ→merge  ─▶  data/wc2026.json ──fetch──▶ index.html（描画）
   （手管理データ）        │            ▲
   前回の wc2026.json ─────┘            │
   （フォールバック源）                 └ 更新したいときに `npm run update` を実行（cron なし）
```

- **自動取得（ESPN）**: ①日本の次戦/日程・結果　②グループF順位表（試合数・勝分敗・得失点）　③決勝T組み合わせ　④大会フェーズ進行
- **`data/static.json` で手管理**（データAPIに無い項目）: 予想スタメンの座標 `lineups`、登録26名の背番号/所属/年齢、対戦国スカウティング文、`nedKey`（警戒選手）、全12組のドロー、放送/会場、ノックアウトのテンプレート 等
- **フォールバック**: 取得失敗・レート制限時でも前回の `data/wc2026.json` を保持するので画面は壊れません。

---

## 更新のしかた（オンデマンド）

更新したいタイミングで、以下を実行します。

```bash
npm run update      # ① ESPN から事実データ（順位・日程・結果・次戦・決勝T）を取得して wc2026.json を更新
# （必要に応じて）data/static.json の記述系を編集（予想スタメン・スカウティング文 など）
git add -A && git commit -m "update data" && git push   # ② GitHub Pages に反映
```

> **このセッション内で Claude に「データ更新して」と頼めば、①〜②をまとめて実行**します
> （ESPN取得 → **順位表だけでなく予想スタメン等の記述系も最新化** → commit/push）。
> 運用ルール: 更新時は順位表と同様に**予想スタメンも必ず見直して push** します。

### 過去データの閲覧（履歴）

更新で `data/wc2026.json` が変化するたび、`data/history/wc2026-<日時>.json` にスナップショットを保存します
（初回は現状をベースラインとして1件保存）。

公開ページ右上の **「最新 ▾」セレクト**から過去の日時を選ぶと、その時点のダッシュボード（順位表・日程・予想スタメン等すべて）を再描画して閲覧できます。過去表示中は上部に黄色のバナーが出て、「**最新に戻る**」で現在に戻れます。

- 履歴は時刻順（新しい順）に `data/history/index.json` で管理。
- スナップショットはフル `wc2026.json` なので、当時のスタメンや順位もそのまま見られます。

### 自動取得される項目 / 手で編集する項目

| 区分 | 内容 | どうする |
|---|---|---|
| 自動（ESPN） | グループF順位表、日本の日程・結果・スコア、次戦、決勝T進行、大会フェーズ | `npm run update` だけ |
| 手編集（記述系） | 予想スタメン座標、26名（背番号/所属/年齢/主将・追加・離脱）、スカウティング文、`nedKey`、全12組、放送/会場 | `data/static.json` を編集 → `npm run update` で反映 |
| 手編集（結果を手入力したい場合） | スコア・順位を自前で入れたい | `data/wc2026.json` を直接編集（`npm run update` を流しても手編集は保持される） |

---

## ディレクトリ構成

```
.
├─ index.html                 公開ページ（fetch して描画）
├─ worldcup2026-japan-dashboard.html  デザイン原本（無改変）
├─ data/
│  ├─ static.json             手管理データ＋名称マッピング＋ノックアウトテンプレ＋seed
│  ├─ wc2026.json             生成物。画面が読む最新データ＝フォールバック源（必ずコミット）
│  └─ history/                過去スナップショット（更新のたびに保存）＋ index.json
├─ scripts/
│  ├─ update.mjs              取得→マップ→merge→書き出し（エントリ）
│  ├─ lib.mjs                 共通（fetch リトライ・JST 日付整形）
│  └─ providers/
│     ├─ espn.mjs             ESPN 公開JSON アダプタ（無料・キー不要・既定）
│     ├─ football-data.mjs    football-data.org アダプタ（要キー）
│     └─ api-football.mjs     API-Football(api-sports.io) アダプタ（要キー）
├─ .env.example
└─ package.json               依存ゼロ（Node18+ の標準 fetch を使用）
```

---

## セットアップ

### 1. データ提供元を選ぶ

`update.mjs` は3つに対応。**既定は `espn`（APIキー不要・無料）**。通常は変更不要です。

| プロバイダ | キー | 取得先 / 備考 | 既定の対象 |
|---|---|---|---|
| **`espn`（既定）** | **不要** | ESPN の公開JSON。WC2026 をフル取得（順位表＋全日程）。非公式エンドポイントのため将来仕様変更の可能性あり | `fifa.world` / 2026 |
| `football-data` | 要・無料 | <https://www.football-data.org/client/register>（10req/分）。WC2026 の無料枠カバレッジは要確認 | `competition=WC` |
| `api-football` | 要 | <https://www.api-football.com/>（api-sports.io）。**無料プランは2026シーズン非対応**＝有料プランが必要 | `league=1, season=2026` |

### 2. `.env` を用意する（espn なら任意）

```bash
cp .env.example .env
```

`espn` を使う場合、`.env` は無くても動きます（既定で `espn`・キー不要）。
`football-data` / `api-football` を使うときだけ編集:

```dotenv
FOOTBALL_API_PROVIDER=espn   # 既定。キー不要
FOOTBALL_API_KEY=            # espn では空でOK（要キーのプロバイダのときだけ記入）
```

### 3. データ取得をローカル実行する

```bash
npm run update     # = node scripts/update.mjs
```

成功すると `data/wc2026.json` が更新されます。取得失敗時は前回値を保持して終了します（画面は壊れません）。

### 4. ローカルで表示確認する

`index.html` は `fetch` を使うため、`file://` ではなく **HTTPサーバ経由**で開きます。

```bash
npm run serve                    # → http://localhost:5000
# 代替: python3 -m http.server 5000
```

### 5. GitHub Pages で公開する

1. リポジトリを GitHub に push。
2. **Settings → Pages** で **Source = Deploy from a branch**、**Branch = `main` / `(root)`** を選択して保存。
3. 公開URLは `https://<ユーザー名>.github.io/<リポジトリ名>/`。
4. 以後、`npm run update` → commit → push するたびに反映されます（**cron も Secret も不要**）。

---

## 手管理データの更新（`data/static.json`）

データAPIに無い・自分の言葉で書く部分はここを編集します。編集後に `npm run update` で `wc2026.json` に反映されます。

- `lineups.jp` / `lineups.ned` … 予想スタメンの選手と **ピッチ座標 `x,y`（%）**
- `squad` / `nedSquad` … 登録26名（背番号・所属・年齢・`cap`/`in`/`out` フラグ）
- `squadNote` / `nedNote` … 注記（HTML可）
- `opponents` / `nedKey` … 対戦国スカウティング文・警戒選手
- `groups` … 全12組のドロー（空欄は `["",""]`）
- `teamNames` / `tlaNames` … 取得元の英語名・略号 → 日本語（未登録は英語名のまま表示）
- `teamMeta` … スコアボードの「FIFA◯位・ポット◯」表記
- `matchInfo` … 各節の会場・放送（英語会場名ではなく日本語表記を使う）
- `knockoutTemplate` … ノックアウトのテンプレート（下記）

### ノックアウト解決ロジック

`update.mjs` は **F組での日本の最終順位**に応じて `knockoutTemplate` を選びます。

- `"1"`（1位通過）= デザイン原本の最短ルート。設定済み。
- `"2"`（2位通過）/ `"3"`（3位＝成績上位）= **編集用スケルトン**（`tbd:true`）。FIFA 公式ブラケットの確定試合番号・対戦組を入れて書き換え。
- グループ3試合が消化されるまでは `"1"`（1位想定）の最短ルートを表示（原本の挙動を維持）。
- 他組が全消化されると、ブラケット内の `C組2位` などのトークンを **実チーム名**へ自動置換します。

---

## トラブルシュート

- **画面が「読み込み失敗」**: `data/wc2026.json` が配信されているか確認（`fetch('./data/wc2026.json')`）。`file://` では動きません。HTTPサーバ経由で開いてください。
- **データが更新されない**: `npm run update` を実行したか確認。ESPN 取得失敗時はフォールバックで前回値を保持します（壊れはしません）。`[update]` のログを確認。
- **チーム名が英語のまま**: `static.json` の `teamNames` / `tlaNames` に対応を追記してください。
- **ESPN の仕様変更でうまく取れない**: `FOOTBALL_API_PROVIDER=football-data`（要・無料キー）に切替を検討。`scripts/providers/` のアダプタは共通形なので差し替え可能です。

---

2026年6月時点の公開情報に基づく非公式まとめ。最新の確定情報は JFA / FIFA 公式でご確認ください。
