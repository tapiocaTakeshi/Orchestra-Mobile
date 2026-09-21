# Orchestra-Mobile

**Orchestra IDE のリモートコントローラー (React Native / Expo)**

手元のスマホから、PC で動いている [Orchestra](https://github.com/tapiocaTakeshi/Orchestra) を操作するアプリです。

| タブ | できること |
| --- | --- |
| 🎛 リモート | エージェントへの指示・中断、ツール実行の承認/却下、スレッド切替、エディタ操作のワンタップ実行 |
| 🗂 カンバン | `.orchestra/kanban.json` のボード閲覧・編集、カード移動、カラムの追加/編集/削除、絞り込み、チェックリスト、コメント、タスクのエージェント実行、自動実行の ON/OFF |
| 🎭 Division | `.division/projects.json` のプロジェクト管理、役割の追加/削除とモデル割り当て、有効化、Supabase 同期、割り当ての共有 |
| 🤝 共有 | 役割とモデルの組み合わせを公開・閲覧・いいね・自分のプロジェクトへ取り込み |
| 📊 コスト | ルーティング方針 (性能/上限コスト/出力トークン) の調整、Jev による見積もり、実測の利用履歴と集計、クレジット残高・自動チャージ・プランの管理 |
| ⚙️ 接続 | 接続先の切替・解除、ワークスペースのファイルを IDE で開く |

IDE との通信 (カンバン閲覧・エージェント操作など) は **同じ LAN 内の IDE と直接** 行い、外部サーバーは
経由しません。一方、**アカウントでのログイン / 接続先の自動検出だけは Supabase (Division) を経由**します
(接続先候補の一覧を得るためだけで、操作そのものは引き続き LAN 直結です)。

**共有タブとコストタブは Division (Supabase / Division API) 直結**なので、PC に接続していなくても使えます。
ログイン後の「接続先を選ぶ」画面から *接続せずにソーシャル / チューニングを見る* を選ぶと、
未接続のままこの 2 つのタブを開けます (プロジェクトへの取り込みと共有だけは接続が要ります)。

---

## 使い方

### 1. IDE 側でリモートコントロールを有効にする

Orchestra の **設定 → リモートコントロール** で「リモートコントロールを有効にする」をオンにします。
コマンドパレットからでも切り替えられます。

- `Remote Control: Toggle Mobile Server` — サーバーの ON/OFF
- `Remote Control: Show Connection Info` — 接続先とトークンの表示 / ペアリングリンクのコピー
- `Remote Control: Regenerate Token` — トークンの作り直し

有効にすると `http://<PC の IP>:39231` で待ち受けが始まります。

### 2. アプリから接続する

#### ① アカウントでログイン (推奨)

1. IDE で Division アカウントにログインした状態でリモートコントロールを有効にする
2. アプリを開き、同じ Division アカウントでログインする
3. 「見つかったデバイス」から対象の PC をタップして接続

同じアカウントでログインしている PC は自動的に一覧へ表示されます (デスクトップ側が
約 25 秒間隔でハートビートを送っているため、有効化から数十秒以内に見つかるはずです)。
新しい PC が追加されるとローカル通知でお知らせします (アプリ起動中/フォアグラウンドのみ。
アプリを完全に閉じていても届く push 通知は今後対応予定です)。

#### ② 手入力・ペアリングリンク (アカウントを使わない場合)

1. スマホと PC を同じ Wi-Fi に繋ぐ
2. ログイン画面や見つからないときの導線から「ペアリングリンクで接続する」を選び、
   IDE でコピーしたペアリングリンク (`orchestra://pair?...`) を貼り付ける
   - 貼り付けが難しければ「手入力」タブでアドレスとトークンを入力する
3. 「接続」をタップ

接続情報は端末内に保存され、次回起動時に自動で復帰します。複数の PC を登録して切り替えることもできます。

### USB 接続で使う (Wi-Fi が使えない場合)

Android なら IDE 側の「LAN からの接続を許可」をオフのままでも、ポート転送で繋がります。

```bash
adb reverse tcp:39231 tcp:39231
# アプリ側の接続先は 127.0.0.1:39231
```

---

## 開発

```bash
npm install
npm start          # Expo Dev Server (Expo Go / 開発ビルドで読み込む)
npm run typecheck  # tsc --noEmit
npm test           # jest (API クライアントと純粋ロジックのテスト)
```

### EAS ビルドの設定 (プロジェクト ID)

`eas build` などを叩くと、まず次の警告が出ます。

```
The "extra.eas.projectId" field is missing from your app config.
```

この ID は EAS がサーバー側で発行する UUID なので、リポジトリに決め打ちでは書けません。
警告を消すにはアカウント側で一度だけ発行する必要があります (既に EAS 上にプロジェクトが
あるなら `--id <uuid>` で紐づけ)。

```bash
npx eas-cli login
npm run eas:init            # 既存プロジェクトなら: npx eas-cli init --id <uuid>
```

発行された ID を環境変数で渡します (`app.config.ts` が `extra.eas.projectId` に差し込みます)。

```bash
export EXPO_OWNER=<EAS のアカウント名>   # 個人アカウントなら省略可
export EAS_PROJECT_ID=<発行された UUID>
npm run build:android
```

`eas init` が `app.json` に ID を書き込んだ場合はそちらが使われるので、環境変数は要りません。

設定できているかは単体でも確認できます。

```bash
npm run eas:check           # 解決された projectId を表示。未設定なら手順を出して exit 1
```

`npm run build:android` / `build:ios` はこのチェックを先に通します。ID が無いまま
`eas build` に進むと、警告のあと対話的に別プロジェクトを作ってしまうことがあるためです。
ID が UUID の形をしていないときは、`app.config.ts` もビルド前にエラーで止めます。

### EAS ビルドの設定 (iOS 証明書)

プロジェクト ID が揃っていても、iOS ビルドを非対話 (CI やスクリプトからの `eas build`) で
叩くと次のエラーで落ちることがあります。

```
Distribution Certificate is not validated for non-interactive builds.
Failed to set up credentials.
Credentials are not set up. Run this command again in interactive mode.
```

EAS のリモート証明書はサーバー側に保存されますが、**Apple 側の検証は誰かが一度対話モードで
通す必要があり**、これはリポジトリの設定では代替できません。ローカルの対話端末から一度だけ
実行してください。

```bash
npx eas-cli login
npm run eas:credentials      # -> iOS を選び、Distribution Certificate を確認/作成
```

対話中に既存の証明書を選ぶか、無ければ新規作成 (Apple Developer アカウントへのログインが
必要) すれば、以後は非対話の `eas build --non-interactive` でもその証明書が使えるように
なります。CI で実行する場合は、この検証を済ませたアカウントの `EXPO_TOKEN` を使ってください。

証明書を検証したあとも、`production` プロファイルが自動で TestFlight に提出しようとする
場合は次のエラーで止まることがあります。

```
Set ascAppId in the submit profile (eas.json) or re-run this command in interactive mode.
```

`ascAppId` は App Store Connect が発行する数値 ID (App Store Connect →
アプリ情報 → Apple ID) で、秘密情報ではないのでリポジトリにそのまま書けます。
`eas.json` の `submit.production.ios.ascAppId` に設定済みです。別アプリに使い回す場合は
この値を書き換えてください。

### ディレクトリ構成

```
app.config.ts                  app.json に EAS のプロジェクト ID / アカウントを差し込む
scripts/eas-preflight.js       ビルド前に EAS のプロジェクト ID が揃っているか確認
App.tsx                        ルート。ログイン/検出/手動接続/タブの切り替え
src/api/types.ts               IDE の remoteControlTypes.ts に対応する型
src/api/client.ts               HTTP クライアント (React 非依存 = テスト可能)
src/lib/pairing.ts             ペアリングリンク / 手入力の解釈
src/lib/connect.ts             接続候補の検証 (ping→state→connect) の共通ロジック
src/lib/divisionAuthConfig.ts  Division (Supabase / Division API) の公開設定
src/lib/divisionAuth.ts        Division ログイン・RemoteSession 一覧取得・購読
src/lib/divisionSession.ts     Division セッションの secure-store 永続化
src/lib/divisionSocial.ts      共有投稿 (AssignmentPost) の取得・公開・いいね・取り込み
src/lib/divisionBilling.ts     プラン・クレジット残高・自動チャージ・Stripe 導線
src/lib/divisionRouting.ts     Division API のルーティング見積もり / 利用履歴
src/lib/social.ts              投稿の変換・絞り込み・要約 (UI 非依存)
src/lib/tuning.ts              方針の検証とコスト集計 (UI 非依存)
src/lib/kanban.ts              ボードの絞り込み・集計 (UI 非依存)
src/lib/format.ts              相対時刻や表示名の整形
src/state/AppContext.tsx       接続情報の保持と /api/state のポーリング
src/state/DivisionAuthContext.tsx  Division ログイン状態 + 新規セッション通知
src/state/storage.ts           AsyncStorage への保存 (接続情報のみ)
src/state/tuningStorage.ts     ルーティング方針の保存
src/components/ui.tsx          共通の UI 部品
src/screens/                   各画面 (ログイン / 検出 / 手動接続 / 各タブ)
```

### 状態の取り方

IDE 側は WebSocket を持たないので、`GET /api/state` を **3 秒間隔** (エージェント実行中は 1.2 秒、
連続失敗中は 8 秒) でポーリングしています。レスポンスの `revision` が変わらない限り
state を差し替えないため、無駄な再描画は起きません。アプリがバックグラウンドの間は
ポーリングを止め、復帰時に即座に取り直します。

### テストの方針

`src/api` と `src/lib` は React Native に依存しない書き方をしてあり、jest (node 環境) で
そのままテストできます。`src/api/__tests__/integration.test.ts` は Node の HTTP サーバで
IDE の API を模して、URL の組み立てからレスポンスの取り出しまでを通しで確認します。

---

---

## 共有 (ソーシャル)

Division の「どの役割をどのモデルに振るか」という組み合わせを、他のユーザーと共有できます。

- **閲覧**: 新着 / 人気 / 取り込み数で並べ替え、タイトルやモデル名で検索
- **いいね**: タップで ON/OFF (いいね数は DB 側のトリガで集計するので、数を直接書き換えることはできません)
- **取り込み**: 既存プロジェクトに重ねる / 置き換える / 新しいプロジェクトとして作る の 3 通り
- **公開**: 共有タブ、または Division タブの各プロジェクトの「この割り当てを共有する」から

共有されるのは **役割とモデルの組み合わせ・タイトル・説明・表示名だけ** です。API キー、コード、
ワークスペースの中身は一切含まれません。投稿を編集・削除できるのは投稿者本人だけです
(Supabase の RLS で強制)。

> テーブル (`AssignmentPost` / `AssignmentPostLike`) のポリシーは Orchestra リポジトリの
> `supabase/migrations/20260920000000_assignment_post_social.sql` にあります。未適用の環境では
> 共有タブが「マイグレーションを適用してください」と表示します。

## チューニング (コスト・管理)

チャットでどのモデルが選ばれるかを、コストと性能の条件で調整します。

| セクション | 内容 |
| --- | --- |
| 方針 | 最低性能スコア (0〜100) / 1 回のモデル呼び出しの上限 (USD) / 割り当て可能な最大出力トークン。検証の条件は IDE 側の `AutoRouting.tsx` と同じ |
| 見積もり | 依頼文を Jev に判定させ、リーダー・コーダー・レビューの想定コストを表示 (**判定のたびに料金が発生します**)。入力トークン数は依頼文から自動で概算 |
| 利用履歴 | モデル実行ごとの実測トークン数と料金。日別 / 役割別 / モデル別の集計、見積もりとの差、リクエスト単位の合計 |
| 管理 | クレジット残高 (購入分・プラン付与分)、これまでの利用額、自動チャージ設定、プラン変更と支払い (Stripe) |

方針はこの端末に保存され、見積もりの条件として使われます。IDE 側の
「設定 → Division」の `divisionAutoRouting` とは別管理です。

見積もりと利用履歴は、Divisionログイン時に発行される Supabase JWT を Bearer トークンとして
Division API (`/api/routing/quote`, `/api/routing/history`) に送ります。APIキーを端末に保存・利用することはありません。

---

## プロトコル

IDE 側のエンドポイント一覧は Orchestra リポジトリの
[`docs/REMOTE-CONTROL.md`](https://github.com/tapiocaTakeshi/Orchestra/blob/main2/docs/REMOTE-CONTROL.md) にあります。
`src/api/types.ts` の `PROTOCOL_VERSION` と IDE 側の値が食い違うと、接続時に警告が出ます。

## セキュリティ

- 認証はトークン 1 本 (`X-Orchestra-Token` ヘッダ) です。トークンを知っている端末は IDE を操作できます。
- 平文 HTTP なので、信頼できる LAN の中だけで使ってください。公衆 Wi-Fi では使わないでください。
- IDE 側の設定で「エージェントへの指示 / カンバン編集 / プロジェクト編集 / コマンド実行」を
  個別にオフにできます。閲覧だけ許可する運用も可能です。
- トークンが漏れたときは IDE 側で `Remote Control: Regenerate Token` を実行してください。
- Division アカウントのログインセッション (Supabase JWT) は `expo-secure-store` (iOS Keychain /
  Android Keystore) に保存され、接続情報 (`Connection`) とは別に管理されます。
- 自動検出はアカウントに紐づく `RemoteSession` テーブルの行 (LAN アドレスとトークン) を読むだけで、
  操作そのものは引き続き LAN 直結です。ログアウトすると、その端末の行は IDE 側で削除されます。
- 共有タブに出す投稿はログイン済みユーザー全員が読めます。公開するのは役割とモデルの組み合わせだけで、
  API キーやコードは含めません。投稿の編集・削除は投稿者本人に限られます。
- Division APIはログイン中のSupabase JWTで認証します。JWTの期限が切れた場合はrefresh tokenで更新します。
- 支払いはアプリ内では行わず、Stripe の画面をブラウザで開きます。
