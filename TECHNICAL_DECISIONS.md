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

## TD-011 戦闘ルール（PHASE 3）
- 戦闘状態は battle_logs.state(JSONB) にサーバー保持、アクションは FOR UPDATE トランザクション＋turn番号一致必須（不一致409 stale_turn）
- 報酬は rewards_committed フラグ＋transactions 'battle:<id>' の ON CONFLICT で二重付与防止
- 切断: 30分以内は再開、超過は放棄（abort）。アクティブ戦闘はキャラ毎1件（部分ユニーク索引）
- 敗北: HP最大値の30%で復帰、アステリアへ。逃走式・防御(かばう)は shared/battle.ts 準拠

## TD-012 アイテム・位置（PHASE 4）
- 素ステータス(characters)と装備補正を分離し、戦闘開始時に合算。強化値は inventory 行に保持。
- 戦闘ドロップは枠上限を無視（取りこぼし防止）、採集/製作/使用は上限厳守で `inventory_full`。
- 冪等性: クライアント生成 requestId を `transactions(req:<id>)` に結果ごと保存し、同キャラ行ロック下で再送時は同結果を返す（別種別の再利用は409）。
- 位置: PUT position を400ms間隔、速度上限 `PLAYER_SPEED·dt·1.35+40`（dt≤5s）と通行判定で拒否→サーバー座標へ補正。マップ遷移はポータル矩形内にいる場合のみ。

## TD-013 NPC・クエスト（PHASE 5）
- NPC定義（台詞/サービス）は @astral/shared npcs.ts、位置はマップJSON（サーバーが距離判定に使用、NPC_RANGE=80）
- 品揃えは shop_items テーブル。クエスト進捗は character_quests.progress（`kill:<monster>`）を戦闘勝利コミット時にサーバーが加算
- 報酬は status 遷移（active→rewarded, 行ロック）と transactions 一意キーの二重ガード。デイリーは rewarded_at を JST 日付で判定

## TD-014 リアルタイム同期（PHASE 6）
- Colyseus ルームはマップ単位（filterBy mapId）。ポータル等のマップ遷移は従来通り HTTP、シーン再生成時にルームを入れ替える
- 位置の正はDB＋サーバー検証。ルームの move は1件処理中＋最新1件のみ保留（合体）でDB書込みを抑制。強制同期（会話・採集・ポータル前）は HTTP のまま
- 接続先 `ws://<host>:2567`（VITE_GAME_WS で上書き）。Vite プロキシは /api のみ
- 再接続猶予15秒。同キャラの新規参加時は猶予中の旧席を reject して削除（ゴースト防止）

## TD-015 ソーシャル/チャット（PHASE 7）
- チャットは Colyseus WorldRoom のメッセージ、ソーシャル操作は REST + サーバーからの 'social' プッシュ（クライアントは再取得）
- server/src/rooms/hub.ts: characterId→接続のプロセス内レジストリ。Party/Guild/System 配信と戦闘中フラグに使用。単一プロセス前提（複数ノード化時は Redis presence へ置換）
- スパム判定はメモリ内（プロセス単位）。Local は channel 'say'、scope=mapId で保存
- 招待は social_invites（migration 006）、party_members.character_id にユニーク制約

## TD-016 インスタンスダンジョン/パーティー戦闘（PHASE 8）
- 1回の攻略 = dungeon_instances 1行。在室は dungeon_members（キャラごとに有効1件の部分ユニーク索引）。マスターは `packages/shared/src/dungeons.ts`（推奨Lv・入場条件Lv・制限時間・階層・敵・ボス・宝箱・報酬・再入場クールダウン）
- 入場はパーティーリーダーのみ。同マップ・オンライン・戦闘中でない・入場条件を満たすメンバーを一括入場（満たさない人はスキップして通知）
- パーティー戦闘は battle_logs（character_id NULL、participants 配列、pending/deadline_at）。全生存メンバーのコマンドが揃うか、未提出者が全員オフライン、または期限（DUNGEON_TURN_MS=20秒）経過で解決（未提出=防御）。期限はサーバーの1秒スイープ
- コマンドは提出時に乾式検証（固定乱数）するため、不正コマンドでパーティーが止まらない。アイテムは各自の所持品から消費
- 報酬: 戦闘はフラグ1回反転＋メンバー別 transactions 一意キー、宝箱/クリア報酬は rewards_claimed の条件付きjsonb更新＋一意キーの二重ガード
- ボスのフェーズ制: monster_definitions.behavior.phases（HP割合しきい値で倍率と行動表を差し替え、shared の resolveTurn で判定）。フェーズ表はクライアントへ送らない
- DungeonRoom（instanceId でフィルタ）は在室・通知の経路のみ。状態の正は Postgres + REST
- 環境: /opt が箱リセットで消えるため PG バイナリは `/workspace/.tools/astral-pg`、`scripts/bootstrap-env.sh` で再構築（node_modules・PGバイナリ・空ディレクトリ）
