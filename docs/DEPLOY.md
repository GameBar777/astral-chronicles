# デプロイ / 運用手順（PHASE 10 リリース準備）

> **未実施・未検証の項目を含みます。** 開発箱には Docker が無く、外部ホスティングへの実デプロイ・独自ドメイン・TLS 証明書もまだありません。
> 検証済み: `npm run build` と `NODE_ENV=production` での同一オリジン配信（Dockerfile 相当の staged tree 含む。docs/PROD_VERIFY.md）。Render 向けの単一サービス起動（`PORT` + `DATABASE_URL` + 起動時 migrate + `REQUIRE_EMAIL_CONFIRMATION=false`）をローカルの専用 DB で確認（下記）。未検証: 実際の `docker build` / `docker compose up`、**Render アカウント上へのデプロイ**。

## 構成
- 1 プロセスの Node サーバー（Express API `/api/*` + Colyseus WebSocket + `client/dist` 静的配信）と PostgreSQL 17。
- 前段に TLS 終端リバースプロキシ（Caddy / nginx 等）を置き、`https://` と `wss://` を同一オリジンで提供する想定。
  `TRUST_PROXY=1` でレート制限・監査ログが実クライアント IP を使う。

## 手順（VPS 等に直接置く場合）
1. Node 22+ と PostgreSQL 17 を用意し、DB とユーザーを作成（パスワードは強いものに。既定値 `CHANGE_ME` のままだと本番起動を拒否）。
2. `.env.example` を `.env` にコピーして `DATABASE_URL` / `NODE_ENV=production` / `ALLOWED_ORIGINS=https://<ドメイン>` / `TRUST_PROXY=1` を設定。
3. `npm ci && npm run build && npm run db:migrate`
4. `NODE_ENV=production node server/dist/index.js`（systemd 等で常駐。起動時にマイグレーション。ホスティングが注入する `PORT` を優先し、無ければ `SERVER_PORT`、既定 2567。`0.0.0.0` にバインド）。死活は `/health` または `/api/status`。
5. プロキシで `https://<ドメイン>` → `http://127.0.0.1:2567`（WebSocket Upgrade を通す）。

## Docker（イメージそのものは未検証）
`DB_PASSWORD=... ALLOWED_ORIGINS=https://<ドメイン> docker compose up -d --build`。起動時にマイグレーションを実行してからサーバーを起動する。
この開発箱では Docker / Podman / runc が無く、apt もプロキシ障害で入れられないため、compose 自体は実行していない。
代わりに `scripts/verify-prod.sh` で最終イメージと同じファイル一式を組み立て、`npm ci --omit=dev`、全11本のマイグレーション、compose 相当の環境変数で `NODE_ENV=production` 起動まで確認した（既定パスワード拒否、`/api/status`、`index.html` / `admin.html`、HSTS、本番のメール確認ゲート）。詳細は docs/PROD_VERIFY.md。


## Render 無料枠（準備済み・未デプロイ）
リポジトリ直下の `render.yaml` が Blueprint。Render ダッシュボードでこのリポジトリを接続し、Blueprint を適用すると次が作られる想定:

- free Web Service `astral-chronicles`（Node 22）: ビルド `npm ci && npm run build`、起動 `node server/dist/index.js`（起動時にマイグレーション）、`healthCheckPath: /health`、`0.0.0.0:$PORT`
- free Postgres 17 `astral-chronicles-db`（DB 名 `astral`）: `DATABASE_URL` は connectionString から自動配線（SSL 付き）
- 固定環境変数: `NODE_ENV=production`、`TRUST_PROXY=1`、`REQUIRE_EMAIL_CONFIRMATION=false`、`NODE_VERSION=22`、`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`
- `SESSION_SECRET` は `generateValue: true` で自動生成。アプリのセッションは DB の不透明トークン（この値は未使用）

手動入力が必要な変数は無い（初回デプロイ後、独自ドメインを使う場合だけ `ALLOWED_ORIGINS` を足す。未設定なら `RENDER_EXTERNAL_URL` を WS Origin に使う）。

このプレイテストではメール確認を切っている。SMTP は無く、確認メールは届かない。パスワード再設定メールもローカルファイルにしか書かれない。確認を必須に戻すときは `REQUIRE_EMAIL_CONFIRMATION` を外すか `true` にする（その場合は送信手段が別途必要）。

### 無料枠の制約
- **Web Service**: 15 分インバウンド無し（HTTP / 既存 WS 含む）でスリープ。次のリクエストで約 1 分かけて起動し、その間ブラウザには Render の待ちページが出る。スリープで WebSocket は切れる。ローカルファイルは再起動で消える（DB は残る）。メモリ 512MB のため、ビルドが OOM になる可能性がある
- **Postgres**: 作成から 30 日で期限（14 日の猶予のあと削除）。容量 1GB、ワークスペースあたり同時に 1 つ、バックアップなし、メンテや再起動が予告なく入ることがある

### ローカルでの同等確認（2026-11-12 Asia/Tokyo）
専用 DB `astral_rendertest`、`NODE_ENV=production PORT=2680 BIND_HOST=0.0.0.0 REQUIRE_EMAIL_CONFIRMATION=false` で `node server/dist/index.js` を起動。migration 001–011 を自動適用、`/health` 200、`/` と `/admin.html` 配信、`/matchmake` は SPA フォールバックしない、登録直後のログインが通る、E2E `client/e2e/phase2.mjs` 19/19。**Render 上では動かしていない。**

## 管理者 / GM の設定
ロールは DB の `users.role`（`player` / `gm` / `admin`）のみで決まる（クライアントからは変更不可）。
```sql
UPDATE users SET role='admin' WHERE email='you@example.com';
```
管理 API（要ログイン・レート制限・すべて `audit_logs` に記録）:
| メソッド | パス | 権限 | 内容 |
|---|---|---|---|
| GET | /api/admin/status | gm | オンライン数・メンテ状態 |
| GET | /api/admin/logs?action= | gm | 監査ログ（ログイン成功/失敗・管理操作） |
| POST | /api/admin/announcements {title, body, hours?} | gm | お知らせ作成（オンライン全員に通知） |
| POST | /api/admin/mute {name, minutes} | gm | 発言制限（永続） |
| POST | /api/admin/maintenance {on, message} | admin | メンテナンス切替（一般プレイヤーの API・ログイン・入室を 503） |
| POST | /api/admin/ban {name, ban} | admin | 利用停止/解除（停止時は全セッション失効・切断） |
| POST | /api/admin/grant {name, itemId, qty, grantId} | admin | アイテム補填（grantId で冪等） |
管理画面 UI はスタッフ専用の `/admin.html`（メンテ切替・お知らせ・ミュート/BAN・アイテム補填・監査ログ）。E2E `client/e2e/admin.mjs` 10/10。

## バックアップ
`pg_dump -Fc astral > astral_$(date +%F).dump`、復旧は `pg_restore -d astral --clean`。README の「バックアップ / 復旧」参照。

## セキュリティ設定（実装済み・テスト済み）
CSP / X-Content-Type-Options / X-Frame-Options DENY / Referrer-Policy / COOP、本番のみ HSTS、`/api` は `Cache-Control: no-store`、
JSON ボディ 10KB 上限、WS メッセージ 16KB 上限、`ALLOWED_ORIGINS` による WS Origin 検査、パラメータ化 SQL、全 API レート制限。
