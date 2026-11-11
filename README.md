# ASTRAL CHRONICLES（仮称）
2DオンラインMMORPG。仕様の正本: `docs/SPEC_v1.0_original.txt` / 要約: `PROJECT_MASTER.md` / 進捗: `DEVELOPMENT_STATUS.md`

## 構成（npm workspaces モノレポ）
```
packages/shared  共有型・移動/衝突ロジック（クライアント/サーバー共通）
server           Node + TS + Colyseus 0.16 + PostgreSQL(pg)。migrations/ にSQL
client           Phaser 3.90 + TS + Vite
assets/maps      マップJSON（Tiled互換サブセット）。現在は仮マップ
scripts          DB起動/停止/バックアップ、仮マップ生成
docs             環境調査、スクリーンショット、仕様原文
```

## 起動方法（開発環境）
```bash
npm install
cp .env.example .env        # DATABASE_URL / JWT_SECRET を設定
npm run db:start            # PostgreSQL (PG_BIN, port 5433)
npm run db:migrate          # マイグレーション適用（冪等）
npm run dev:server          # Colyseus :2567  (GET /health)
npm run dev:client          # Vite :5173
```
初回のみPostgreSQLクラスタ作成: `$PG_BIN/initdb -D .pgdata -U astral -A scram-sha-256 --pwprompt -E UTF8` → `createdb -h 127.0.0.1 -p 5433 -U astral astral`
（DockerがないためPostgreSQLバイナリは `@embedded-postgres/linux-x64` から取得。Docker環境では `postgres:17` イメージで代替可）

## テスト
```bash
npm test                         # shared(ユニット) + server(DBスキーマ, 起動)
npm run build                    # 全パッケージ型チェック+ビルド
node client/e2e/phase2.mjs       # ブラウザE2E（dev:server + dev:client起動中、19項目）
python3 scripts/cut-sprites.py      # assets/raw/*.jpg（AI生成原画）→ client/public/sprites/*.png 再生成（TD-010）
```

## 環境変数
`.env.example` 参照。秘密情報は `.env`（git管理外）のみ。クライアントには `VITE_*` 以外は露出しない。

## バックアップ / 復旧
`scripts/db-backup.sh` → `backups/*.dump`。復旧: `pg_restore -h 127.0.0.1 -p 5433 -U astral -d astral --clean <file>`

## デプロイ
`docs/DEPLOY.md` 参照（本番ビルド・同一オリジン配信・管理者設定・管理API）。Dockerfile / docker-compose.yml は**未検証**（箱に Docker 無し）。
本番ビルド確認: `npm run build` → `NODE_ENV=production DATABASE_URL=<既定以外のパスワード> node server/dist/index.js` → `cd client && E2E_URL=http://127.0.0.1:2567/ node e2e/prod-smoke.mjs`

## API（PHASE 2）
`GET /api/classes` `GET /api/exp-table` `POST /api/auth/register|login` `POST /api/auth/logout`※ `GET /api/me`※ `GET|POST /api/characters`※（※ `Authorization: Bearer <token>`）
テストはDB `astral_test` を毎回作り直す（`npm test`）。開発時は Vite が `/api` を `localhost:2567` にプロキシ。

### PHASE 3
`npm run migrate -w @astral/server`（003適用）→ サーバー/クライアント起動 → アステリア東口から草原へ。E2E: `cd client && node e2e/phase3.mjs`

### PHASE 4
- `GET /api/characters/:id/items` / `POST equip|unequip|use` / `PUT position` / `POST portal`
- `GET|POST gathering|gather` / `GET /api/recipes` / `GET|POST crafting|craft` / `POST craft/:jobId/claim` / `POST enhance`
- 変更系は `requestId`（8〜64文字英数-）必須で冪等。E2E: `cd client && node e2e/phase4.mjs`
- 操作: I=持ち物/装備、E=話す/採集（鍛冶屋で製作・強化）

## 箱（開発環境）リセット後の復旧
`bash scripts/bootstrap-env.sh && npm run db:start`（node_modules・PostgreSQLバイナリ `/workspace/.tools/astral-pg`・PGの空ディレクトリを再作成）

## PHASE 8
草原の東側「古代遺跡の入口」で E → 入場。E2E: `cd client && node e2e/phase8.mjs`（3ブラウザ、約4分）

## PHASE 9
取引所 [B]（アステリア内）、ランキング [R]、ギルド管理はソーシャル [O]。E2E: `cd client && node e2e/phase9.mjs`（約1分。ランキングのキャッシュ待ち31秒を含む）

## PHASE 10
- 操作: M=メニュー（キャラクター/装備・持ち物/スキル/クエスト/マップ/ソーシャル/取引所/ランキング/お知らせ/設定）、C=キャラクター、K=スキル、N=マップ、チャット `/w 名前 本文` でささやき
- スマホ（タッチ端末）: 仮想ジョイスティック・E ボタン・MENU ボタン
- 管理者: `UPDATE users SET role='admin' WHERE email='...'` → `/api/admin/*`（docs/DEPLOY.md）
- E2E: `cd client && node e2e/phase10.mjs`（3ブラウザ、約3分）。負荷試験: docs/LOAD_TEST.md

