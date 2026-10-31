# DEVELOPMENT STATUS（更新: 2026-10-31 JST）
現在の段階: **PHASE 0 完了 / PHASE 1 完了（仮素材・単一マップ）** → 次は PHASE 2

## 実装済み（テスト通過済みのもののみ）
| 機能 | 検証 |
|---|---|
| モノレポ構成 (shared/server/client/assets) | `npm run build` 成功 |
| PostgreSQL 17.5 ローカル起動 (port 5433) | 起動・接続確認 |
| SECTION19 全25テーブル + sessions + schema_migrations、PK/FK/CHECK/index | `server/test/migrations.test.ts`（全テーブル存在とPK、冪等、名前大小無視重複禁止、FK、二重報酬キー、gold負数禁止） |
| マイグレーションランナー（トランザクション+advisory lock） | 同上 |
| Colyseusサーバー起動 + `/health`（DB疎通） | `server/test/health.test.ts` |
| 共有8方向移動（斜め正規化）・タイル衝突（足元ヒットボックス、軸分離スライド、トンネリング防止） | `packages/shared/test/core.test.ts` 8件 |
| マップ表示（アステリア仮マップ 40×30）、8方向移動、方向別フレーム、カメラ追従+境界、衝突、Yソート描画順 | ブラウザE2E `client/e2e/phase1.mjs` 14/14 PASS、スクショ docs/screenshots/ |

テスト結果: shared 8/8, server 4/4, E2E 14/14

## 未実装（隠さず列挙）
- 認証（暫定方針のみ決定、コード未実装）・キャラ作成・職業・ステータス・レベル（PHASE 2）
- 戦闘・モンスター・アイテム・装備・強化・採集・生産・クエスト・NPC会話・ショップ
- Colyseusルーム（プレイヤー同期・他プレイヤー表示）、チャット、フレンド、パーティー、ギルド、ダンジョン
- 正式ドット絵/アニメーション（現在は実行時生成の**仮素材**、プレイヤーは方向別静止1フレームのみ）、サウンド
- Tiledでの実マップ制作（現在はスクリプト生成の仮マップ1枚）、マップ切替、他マップ
- 疑似アイソメトリック表示（現状は正面見下ろしのオルソゴナル+Yソート。TD-005参照）
- スマホ仮想ジョイスティック、HUD/メニュー、セキュリティ全般、負荷試験、デプロイ、マスターデータ投入（seed）
