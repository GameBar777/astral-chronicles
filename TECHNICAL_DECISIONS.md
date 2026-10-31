# TECHNICAL DECISIONS

| ID | 日付(JST) | 決定 | 理由 |
|---|---|---|---|
| TD-001 | 2026-10-31 | npm workspaces モノレポ（packages/shared, server, client, assets） | SECTION21 分離要件。pnpmもあるがnpmで依存最小 |
| TD-002 | 2026-10-31 | PostgreSQL 17.5 を `@embedded-postgres/linux-x64` バイナリで `/opt/astral-pg` に配置、データ `.pgdata/`、port 5433 | Docker無し・apt不可。Docker可能環境では `postgres:17` へ移行可能（スキーマ同一） |
| TD-003 | 2026-10-31 | **認証: Supabase Auth の代替案として自前認証を暫定採用（未実装）**。bcrypt(cost 12)パスワードハッシュ + ランダム不透明セッショントークン（DBには SHA-256 ハッシュのみ `sessions` 保存、失効可能）。Colyseus `onAuth` でトークン検証。JWT(HS256, JWT_SECRET)は短命アクセストークン用途の候補 | 仕様はSupabase Authだが、プロジェクト作成とAPIキー（秘密情報）登録にユーザー承認が必要。users.id を uuid にしており Supabase auth.users.id へ移行可能 |
| TD-004 | 2026-10-31 | 移動・衝突ロジックを shared に置き、クライアント予測とサーバー検証で同一関数を使用 | SECTION15 サーバー権威、クライアント値を信用しない |
| TD-005 | 2026-10-31 | 当面はオルソゴナル32px タイル + Y座標ソートで描画。疑似アイソメトリック表現は**未決定（ユーザー確認事項）**。ヒットボックスは足元20×12 | 仕様「斜め見下ろし型の疑似アイソメトリック」を独自に変更しないため、アート方針確定まで描画層を差替え可能に保つ |
| TD-006 | 2026-10-31 | マップは Tiled互換JSONサブセット（layers: ground/collision, objects）。現在の asteria.json はスクリプト生成の仮データ（`_note`） | SECTION04 マップとロジック分離 |
| TD-007 | 2026-10-31 | 二重処理防止: transactions(character_id, idempotency_key) UNIQUE、enhancement_logs.request_id UNIQUE、battle_logs.rewards_committed | SECTION11/14/20 |
| TD-008 | 2026-10-31 | マスターデータ(item/monster等)に is_dummy 列 | SECTION27-4 ダミーと本番データ区別 |
| TD-009 | 2026-10-31 | Phaser 3.90 / Colyseus 0.16.5 / Vite 8.3 / Playwright で E2E | 安定版 |

## 変更履歴
- 2026-10-31: 初版（PHASE 0/1）
