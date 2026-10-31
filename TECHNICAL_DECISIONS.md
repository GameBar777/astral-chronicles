# TECHNICAL DECISIONS

| ID | 日付(JST) | 決定 | 理由 |
|---|---|---|---|
| TD-001 | 2026-10-31 | npm workspaces モノレポ（packages/shared, server, client, assets） | SECTION21 分離要件。pnpmもあるがnpmで依存最小 |
| TD-002 | 2026-10-31 | PostgreSQL 17.5 を `@embedded-postgres/linux-x64` バイナリで `/opt/astral-pg` に配置、データ `.pgdata/`、port 5433 | Docker無し・apt不可。Docker可能環境では `postgres:17` へ移行可能（スキーマ同一） |
| TD-003 | 2026-10-31 | **認証: 自前認証で確定（ユーザー決定・実装済）**。bcryptjs（本番 cost 12、テスト 4）+ 32byteランダム不透明トークン（DBには SHA-256 のみ `sessions`、7日有効、ログアウトで失効）。未登録メールもダミーハッシュ比較でタイミング均一化、エラーは汎用401。登録/ログインはIPレート制限。Colyseus `onAuth` は PHASE 4 で同じ `resolveSession` を使う | Supabase不採用（ユーザー決定）。users.id は uuid のまま |
| TD-004 | 2026-10-31 | 移動・衝突ロジックを shared に置き、クライアント予測とサーバー検証で同一関数を使用 | SECTION15 サーバー権威、クライアント値を信用しない |
| TD-005 | 2026-10-31 | **描画: 疑似アイソメトリック（3/4斜め見下ろし・16bit風）で確定（ユーザー決定・実装済）**。論理は直交32pxグリッドのまま、立体物は「足元フットプリント」で衝突、スプライトは原点(0.5,1)でフットプリント下端に置き上方へ伸ばす。深度＝フットプリント下端y、プレイヤー深度＝足元y。ヒットボックス足元20×12。マップJSONに `projection: oblique_3_4` と objects の tx/ty/fw/fh | 菱形isoより衝突・サーバー検証が単純で、参考画像（3/4見下ろしの町）の見た目を再現できる |
| TD-006 | 2026-10-31 | マップは Tiled互換JSONサブセット（layers: ground/collision, objects）。現在の asteria.json はスクリプト生成の仮データ（`_note`） | SECTION04 マップとロジック分離 |
| TD-007 | 2026-10-31 | 二重処理防止: transactions(character_id, idempotency_key) UNIQUE、enhancement_logs.request_id UNIQUE、battle_logs.rewards_committed | SECTION11/14/20 |
| TD-008 | 2026-10-31 | マスターデータ(item/monster等)に is_dummy 列 | SECTION27-4 ダミーと本番データ区別 |
| TD-009 | 2026-10-31 | Phaser 3.90 / Colyseus 0.16.5 / Vite 8.3 / Playwright で E2E | 安定版 |

## 変更履歴
- 2026-10-31: 初版（PHASE 0/1）
| TD-006 | 2026-10-31 | 経験値: `expToNext(L)=floor(30·L^2.3+70·L)`（Lv1→2=100）。exp は現レベル内の進捗。Lv100で打ち止め（exp=0、超過分は破棄として返す）。モンスターEXPはレベル差係数 clamp(1+0.1·差, 0.1, 1.5)、最低1。付与はサーバーのみ `grantExp`（transactions の冪等キー）。クライアント付与APIは無し | 仕様SECTION 07 の具体式が無いため明示 |
| TD-007 | 2026-10-31 | ステータス派生: ATK=STR×2, DEF=floor(VIT×1.5), MATK=INT×2, MDEF=floor((INT+VIT)×0.6), 最大HP=基本+成長×(Lv-1)+VIT×2, 最大MP=基本+成長×(Lv-1)+INT。レベルアップでHP/MP全快 | 暫定バランス。PHASE 3で調整 |
| TD-008 | 2026-10-31 | テストDBは `astral_test` を毎回スキーマ再作成。日本語フォントは DotGothic16（@fontsource, SIL OFL 1.1）を同梱し、ゲーム開始前に `document.fonts.load` | BUG-002 対策。OFLは商用同梱可 |
| TD-009 | 2026-10-31 | 名前検証: NFKC正規化+trim、2〜12コードポイント、ひらがな/カタカナ/漢字/英数字/ー・のみ、数字のみ不可、禁止語は英字=単語単位・日本語=部分一致（大小無視、BUG-005）、重複はDBの lower(name) UNIQUE | クライアント検証はUX用、サーバーが正 |
| TD-010 | 2026-10-31 | アート: GenerateImage でオリジナル画像（マゼンタ背景）を生成し `assets/raw/` に保存、`scripts/cut-sprites.py` でキー抜き・連結成分切出し・縮小し `client/public/sprites/` へ。32pxグリッド基準（家5〜6タイル幅、小物1タイル）。参考画像は様式参照のみで切り貼りしない。地面は256pxシームレステクスチャをマスク合成。カメラズーム1.5 | 素材の権利: AI生成物の商用利用方針は**ユーザー確認待ち** |
