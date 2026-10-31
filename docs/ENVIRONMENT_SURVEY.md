# 環境調査結果（SECTION 29） 2026-10-31 21:50 JST
| 項目 | 結果 |
|---|---|
| ターミナル | 可（bash, Debian trixie, user `box`, sudo可） |
| ファイル作成・編集 | 可 |
| Node.js / npm / pnpm | v24.22.1 / 11.21.1 / 10.34.6 |
| Git | 2.47.3（ローカルのみ。GitHub未接続） |
| Docker | **不可**（docker CLIなし） |
| PostgreSQL | psqlクライアント17のみ。apt-getはミラーが500/署名エラーで**不可**。→ npm `@embedded-postgres/linux-x64@17.5.0-beta.15` のPostgreSQL 17.5バイナリを `/opt/astral-pg` に配置し、`.pgdata/` にクラスタ作成、port 5433で起動（成功） |
| 外部接続 | HTTPS(npm registry)可。apt HTTPミラーは不可 |
| 開発サーバー起動 | 可（Vite :5173, Colyseus :2567, テスト用 :25670） |
| ブラウザ確認 | 可（Playwright chromium headless + SwiftShader WebGL） |
| 永続性 | /workspace はディスク(128GB, 空き109GB)上で永続。ただしプロセスはbox再起動で停止するため `npm run db:start` で再起動が必要 |
| 使用中ポート(回避) | 1339,1340,2375,4190,6080,6081,8099,8765,8790,26500 等 → 5432未使用だが他用途衝突回避で5433を使用 |
