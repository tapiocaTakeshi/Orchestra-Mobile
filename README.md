# Orchestra-Mobile

**Orchestra IDE のリモートコントローラー (React Native / Expo)**

手元のスマホから、PC で動いている [Orchestra](https://github.com/tapiocaTakeshi/Orchestra) を操作するアプリです。

タブバーは無く、最初の画面は ChatGPT のアプリのような見た目のホームです。

- **見出しのモード切り替え** … 題名を押して「クラウドエージェント」と「リモートコントロール」を切り替える
  (リモートコントロールは、PC に接続中ならチャット、未接続なら接続先の一覧)
- **ナビゲーションドロワー** … 見出し左の ☰ で左から開き、Division (プロジェクト管理)・カンバン・UI (エディタ操作)・ソーシャルを開く。
  PC 接続が要るものは鍵の印。下端はアカウント (接続の設定・切断・ログアウト)。
  閉じているときは完全に非表示で、常設の幅・余白は残らない。項目を選ぶとドロワーは閉じる (背景のタップ・「メニューを閉じる」・Android の戻るキーでも閉じる)
- **入力欄の「コスト」** … どちらのモードでも、書いている指示の見積もり・ルーティング方針・残高をその場で開く

ドロワーから開いたページは「戻る」でホームに戻ります。

| 画面 | できること |
| --- | --- |
| 🏠 ホーム (最初の画面) | クラウドエージェントの起動・一覧 / リモートコントロール (PC のチャット: 指示・中断、ツール実行の承認/却下、右上の 🕘 からスレッド切替)。入力欄からコスト調整 |
| 🗂 カンバン | `.orchestra/kanban.json` のボード閲覧・編集、カード移動、カラムの追加/編集/削除、絞り込み、チェックリスト、コメント、タスクのエージェント実行 (PC / クラウド)、自動実行の ON/OFF |
| 🎭 Division | `.division/projects.json` のプロジェクト管理、役割の追加/削除とモデル割り当て、有効化、Supabase 同期、割り当ての共有 |
| ☁️ クラウド | クラウドで動くエージェントのセッションを起動 (GitHub 連携で選んだリポジトリ (非公開も可) / Git の URL / 空のフォルダ、最大 10 個並列、モデルに Division Project (マルチエージェント) も選べる、Division のプロジェクト指定)・監視・追加指示・停止・アーカイブ、変更ファイルと差分の閲覧、セッションごとの料金。PC から起動したセッションも続けられる。上の段からプロジェクト・コスト・カンバンへ |
| 🤝 共有 | 役割とモデルの組み合わせを公開・閲覧・いいね・自分のプロジェクトへ取り込み |
| 📊 コスト | ルーティング方針 (性能/上限コスト/出力トークン) の調整、Jev による見積もり、実測の利用履歴と集計、クレジット残高・自動チャージ・プランの管理 |
| ⚡ クイック操作 | すべて保存・ターミナルを開く・ウィンドウ再読み込みなど、エディタ操作のワンタップ実行 |
| ⚙️ 接続 | 接続先の切替・解除、ワークスペースのファイルを IDE で開く、Division アカウントのログアウト |

IDE との通信 (カンバン閲覧・エージェント操作など) は **同じ LAN 内の IDE と直接** 行い、外部サーバーは
経由しません。一方、**アカウントでのログイン / 接続先の検出 / 接続先がそのアカウントの PC かの確認だけは
Supabase (Division) を経由**します (接続先候補の一覧を得るためだけで、操作そのものは引き続き LAN 直結です)。

**クラウド・共有・コストは Division (Supabase / Division API) 直結**なので、PC に接続していなくても使えます。
未接続のときも、ホームのクラウドエージェント・ドロワーのソーシャル・入力欄のコストから使えます
(プロジェクトへの取り込みと共有だけは接続が要ります)。

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

アプリが繋ぐのは、**ログイン中の Division アカウントのセッション (同じアカウントでログインしている PC) だけ**です。
ログインしないと接続できず、別のアカウントでログインしている PC には繋ぎません。

#### 見つかったデバイスから接続

1. IDE で Division アカウントにログインした状態でリモートコントロールを有効にする
2. アプリを開き、同じ Division アカウントでログインする
3. 「見つかったデバイス」から対象の PC をタップして接続

同じアカウントでログインしている PC は自動的に一覧へ表示されます (デスクトップ側が
約 25 秒間隔でハートビートを送っているため、有効化から数十秒以内に見つかるはずです)。
新しい PC が追加されたときと、PC のチャットで `/remote-control` を送ったときは、その場でローカル通知でお知らせします
(接続していなくても届きます。アプリ起動中/フォアグラウンドのみ。
アプリを完全に閉じていても届く push 通知は今後対応予定です)。

接続する前に、選んだ PC のトークンがアカウントの RemoteSession にあるかを確かめます。
無ければ「この PC は、ログイン中のアカウントのセッションではありません」と表示して繋ぎません。
PC 側も、アプリが送る Division の JWT のユーザーが PC のアカウントと違えば `403 account_mismatch` で断ります。

接続情報は端末内に保存され、次回起動時に自動で復帰します。保存した接続は保存したアカウントに
ひも付いていて、別のアカウントでログインしているあいだは一覧に出ません。ログアウトすると PC との
通信を止め (同じアカウントでログインし直せば復帰します)、別のアカウントでログインすると接続を切ります。
PC 側のアカウントが途中で変わった場合も、その場で切断します。

#### 外出先から接続する

PC と同じ Wi-Fi にいないとき (モバイルデータ・別の Wi-Fi) は、自動で中継 (Supabase Realtime) 経由に
切り替わります。設定は要りません。PC で Orchestra が起動していて Division にログインしていれば、
外出先からもチャット・承認・カンバンなどをそのまま操作できます。中継中はヘッダーに「接続済み (外出先)」と
出て、同じ Wi-Fi に戻ると 30 秒ほどで直接の接続に戻ります。

中継に流れる内容は、ペアリングのトークンから作った鍵でエンドツーエンド暗号化されます (AES-256-GCM)。
通信量を抑えるため、中継中は状態の取得間隔を少し空けます (通常 5 秒、実行中 2 秒)。

### PC のチャットをスマホで続ける (`/remote-control`)

PC のチャット欄で `/remote-control` と送ると、そのチャットがスマホと同期されます。
接続中ならチャット画面がそのチャットに切り替わり、「PC のセッションを同期しました」と通知が出ます
(ヘッダーの状態表示は「PC と同期中」になります)。未接続なら、PC がすぐに「見つかったデバイス」に
出るので、選べばそのチャットが開きます。

同期中は PC で別のチャットを開いても、スマホには同期したチャットが出続けます。やめるときは
PC で `/remote-control off` と送ります。詳しくは Orchestra の
[`docs/REMOTE-CONTROL.md`](https://github.com/tapiocaTakeshi/Orchestra/blob/main2/docs/REMOTE-CONTROL.md) を参照してください。

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

### Xcode Cloud でビルドする

EAS の代わりに、Apple の Xcode Cloud でも iOS 版をビルド・TestFlight 配信できます。
`ios/` はコミットしていない (Expo の managed workflow のまま) ので、Xcode Cloud が
リポジトリを clone した直後に `ios/ci_scripts/ci_post_clone.sh` が毎回ネイティブプロジェクトを作ります。

1. Homebrew で Node (既定は `node@22`) を入れる。CocoaPods が無ければそれも入れる
2. `npm ci`
3. `npx expo prebuild --platform ios` (チーム ID とビルド番号をここで差し込む)
4. `pod install`

`app.json` を変えても、次のビルドの prebuild でそのまま反映されます。

#### 初回のセットアップ (Mac で一度だけ)

ワークフローは Xcode から作るので、手元で一度だけ iOS プロジェクトを生成します
(`ios/` は `.gitignore` 済みで、`ios/ci_scripts/` だけがコミット対象です)。

```bash
npm ci
APPLE_TEAM_ID=<チーム ID> npx expo prebuild --platform ios
open ios/OrchestraMobile.xcworkspace
```

Xcode で Xcode Cloud のワークフローを作成し、次のように設定します。

| 項目 | 値 |
| --- | --- |
| ワークスペース / スキーム | `ios/OrchestraMobile.xcworkspace` / `OrchestraMobile` |
| Environment → Environment Variables | `APPLE_TEAM_ID` = チーム ID (developer.apple.com → Membership details の 10 文字) |
| Actions | Archive (iOS)。配信するなら Deployment Preparation を TestFlight / App Store に |

App Store Connect には、バンドル ID `com.hero.orchestra` のアプリ (`eas.json` の `ascAppId` と同じもの) が
登録済みである必要があります。

任意の環境変数:

| 変数 | 用途 |
| --- | --- |
| `NODE_FORMULA` | Homebrew の Node フォーミュラを変える (例: `node@24`) |

#### ビルド番号

`CFBundleVersion` には Xcode Cloud の `CI_BUILD_NUMBER` を使います (`app.config.ts` が
`IOS_BUILD_NUMBER` として受け取る)。EAS (`appVersionSource: remote`) で同じバージョンを
アップロード済みの場合、それ以下の番号は App Store Connect に弾かれるので、Xcode Cloud の設定で
次のビルド番号を EAS の最新より大きくしておいてください。EAS 側のビルドはこれまで通りで、
環境変数を渡さない限り `app.config.ts` は何も上書きしません。

### ディレクトリ構成

```
app.config.ts                  app.json に EAS のプロジェクト ID / アカウント、Xcode Cloud のチーム ID / ビルド番号を差し込む
scripts/eas-preflight.js       ビルド前に EAS のプロジェクト ID が揃っているか確認
ios/ci_scripts/ci_post_clone.sh  Xcode Cloud: clone 直後に prebuild と pod install を行う
App.tsx                        ルート。ログイン/ホームと、ドロワーから開くページの切り替え
src/screens/HomeScreen.tsx     ホーム。ナビゲーションドロワーとモード切り替え (クラウドエージェント / リモートコントロール)
src/navigation.ts              ページとドロワーに並べるページ、未接続でも開けるかの定義
src/api/types.ts               IDE の remoteControlTypes.ts に対応する型
src/api/client.ts               HTTP クライアント (React 非依存 = テスト可能)
src/lib/connect.ts             接続候補の検証 (ping→state→connect) の共通ロジック
src/api/relay.ts               外出先から PC に繋ぐ中継 (Supabase Realtime)
src/api/relayCodec.ts          中継メッセージの暗号化・圧縮・分割 (IDE 側と同じ形式)
src/lib/remoteSession.ts       PC の /remote-control で同期されたセッションの通知判定
src/lib/divisionAuthConfig.ts  Division (Supabase / Division API) の公開設定
src/lib/divisionAuth.ts        Division ログイン・RemoteSession 一覧取得・購読
src/lib/divisionSession.ts     Division セッションの secure-store 永続化
src/lib/divisionSocial.ts      共有投稿 (AssignmentPost) の取得・公開・いいね・取り込み
src/lib/divisionBilling.ts     プラン・クレジット残高・履歴 (管理は Division の Web サイト)
src/lib/divisionRouting.ts     Division API のルーティング見積もり / 利用履歴
src/lib/divisionCloud.ts       Division API のクラウドエージェント (セッションの起動・イベント・変更) と表示用の補助関数
src/lib/divisionGitHub.ts      Division API の GitHub アカウント連携 (状態・連携・解除・リポジトリ / ブランチ一覧・連携の完了待ち)
src/lib/divisionProjects.ts    クラウドエージェントで選ぶ Division プロジェクト (Supabase の Project / PC の一覧)
src/lib/social.ts              投稿の変換・絞り込み・要約 (UI 非依存)
src/lib/tuning.ts              方針の検証とコスト集計 (UI 非依存)
src/lib/kanban.ts              ボードの絞り込み・集計 (UI 非依存)
src/lib/format.ts              相対時刻や表示名の整形
src/state/AppContext.tsx       接続情報の保持と /api/state のポーリング
src/state/DivisionAuthContext.tsx  Division ログイン状態 + 新規セッション通知
src/state/storage.ts           AsyncStorage への保存 (接続情報のみ)
src/state/tuningStorage.ts     ルーティング方針の保存
src/components/ui.tsx          共通の UI 部品
src/components/GitHubRepoPicker.tsx    GitHub 連携とリポジトリ / ブランチ選び (クラウドの新規・カンバンのクラウド実行)
src/components/CloudProjectPicker.tsx  クラウドエージェントのプロジェクト選び
src/components/CloudModelPicker.tsx    クラウドエージェントのモデル選び (Division Project / 既定 / 直接指定)
src/theme.ts                   色・余白・角丸 (デスクトップの既定テーマ Orchestra Dark と同じ色)
src/screens/                   各画面 (ログイン / 接続先一覧 / 手動接続 / チャット / 各ページ)
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
- **公開**: 共有ページ右上の ＋、または Division ページの各プロジェクトにある共有アイコンから

共有されるのは **役割とモデルの組み合わせ・タイトル・説明・表示名だけ** です。API キー、コード、
ワークスペースの中身は一切含まれません。投稿を編集・削除できるのは投稿者本人だけです
(Supabase の RLS で強制)。

> テーブル (`AssignmentPost` / `AssignmentPostLike`) のポリシーは Orchestra リポジトリの
> `supabase/migrations/20260920000000_assignment_post_social.sql` にあります。未適用の環境では
> 共有ページが「マイグレーションを適用してください」と表示します。

## クラウドエージェント

デスクトップの Orchestra の「クラウドエージェント」と同じ機能です (Claude Code on the web のようなもの)。
エージェントは Division のサーバー上で、セッションごとに用意される Daytona のサンドボックスの中で動きます。
スマホを閉じても作業は続き、いくつでも (同時に動かせるのは 1 アカウント 10 個まで) 並べて走らせられます。

- **起動**: クラウドページ右上の ＋ から。指示・並列数 (1〜10)・始める場所を選びます。
  並列数を 2 以上にすると、同じ指示で別々のサンドボックスを立て、題名の末尾に `#1`〜`#N` を付けます。
  - **Gitリポジトリ**: 選んだリポジトリをサンドボックスに clone してから始めます。
    - **GitHub と連携** (おすすめ): 「GitHub と連携」を押すとブラウザで GitHub の認可ページが開きます。許可して
      アプリに戻ると、連携が自動で確認され (2 秒ごと・最大 5 分、アプリに戻った時点でもすぐ確認)、
      「GitHub (@login) と連携しました」と出ます。以後は URL を打たずに、自分のリポジトリ (owner / collaborator /
      organization のもの、最近 push した順) を検索して選び、ブランチを選ぶだけです (既定のブランチが初期値)。
      **非公開リポジトリも使えます**: clone は Division のサーバーが連携したアカウントのトークンで行い、
      トークンは端末には保存されません。前回選んだリポジトリとブランチは次回も選ばれた状態になります。
    - **連携の解除**: 新しいセッションのシートで、連携中のアカウント (@login) の横の「解除」から。
      GitHub 側で Orchestra (Division) の OAuth アプリのアクセスを取り消した場合も、次に一覧を開いたときに
      未連携に戻るので、もう一度連携してください。
    - **URL を直接入力**: 「URL を直接入力」から、従来どおり `https://` の URL とブランチを指定できます。
      公開リポジトリのほか、連携中なら github.com の URL も連携したアカウントの権限で clone します。
      URL にユーザー名やトークンは入れられません。
    - GitHub 連携には、**Division サーバーに GitHub OAuth アプリが設定されている必要があります** (管理者が設定)。
      未設定のサーバーでは一覧は出ず、URL の直接入力だけになります (「サーバー側で GitHub 連携が未設定」と表示)。
  - **空のフォルダ**: 何も無いところから作らせるときに使います。
  - **プロジェクト**: Division のプロジェクトを選ぶと、エージェントはそのプロジェクトの「コーダー」に割り当てた
    モデルで動きます (`POST /api/cloud-sessions` の `projectId`)。一覧は PC に接続していれば PC の Orchestra の
    プロジェクト (PC で有効なものが先頭、緑の点)、未接続ならデスクトップと同じく Supabase の `Project` テーブル
    (`or=(ownerId.eq.<uid>,userId.eq.<uid>)`、新しい順) をログイン中の JWT で読みます。「指定なし」も選べます。
    プロジェクトを指定したセッションは、一覧と詳細にプロジェクト名が出ます。
  - **モデル**: デスクトップの IDE のモデルの選択と同じく、先頭に **「Division Project · <プロジェクト名>」** が
    プロジェクトごとに並びます (一覧は上の「プロジェクト」と同じく PC の一覧か Supabase)。続けて
    「既定 (プロジェクトの coder ロール)」と、`provider/model` を入力する「モデルを直接指定」(上級者向け)。
    - **Division Project** を選ぶと、そのプロジェクトのチームで動きます (`model: "division-project"` と `projectId`)。
      プロジェクトのリーダーが指示を役割ごとのタスクに分け、各タスクをその役割に割り当てたモデルがサンドボックスで
      順に進め、最後にまとめます。このとき「プロジェクト」の欄はモデルで選んだプロジェクトに固定され (鍵の印)、
      食い違うことはありません。Division Project なのにプロジェクトが無い組み合わせは起動できません
      (サーバーも 400 を返します)。役割の割り当てが無いプロジェクトはサーバーが断ります。
    - **既定**: モデルを送りません。プロジェクトを選んでいればそのコーダー、無ければサーバーの既定のモデルです。
    - **直接指定**: 入力したモデルがプロジェクトのコーダーより優先されます (空欄なら既定と同じ)。
    - 前回選んだモデル (Division Project ならそのプロジェクト) はアカウントごとに端末に保存し
      (AsyncStorage、ログインし直した別アカウントには持ち越しません)、次に開いたとき選ばれた状態になります。
      プロジェクトが一覧から消えていても「Division Project · プロジェクト <ID の先頭>」として残るので、選び直せます。
    - 一覧と詳細のモデルの欄には、決まるとサーバーの「Division Project · <プロジェクト名>」が出ます。
  - 「詳細」で題名を指定できます。
- **監視**: 一覧は動いているセッションがあれば 4 秒、無ければ 20 秒ごとに更新します (アプリが前面にあるときだけ)。
  セッションを開くと、指示・返答・ツールの実行 (押すと出力)・状態の変化・完了のまとめを 2 秒ごとに追いかけます。
  Division Project のセッションでは、さらに次も出ます。
  - **計画**: リーダーの計画をチェックリストのカードで (役割のチップ・タスクの題名・薄字でモデル、上にリーダーのモデル)。
    各タスクの印は、その後のタスクの進み具合で変わります: ✓ 完了 / ✕ 失敗 / くるくる 実行中 / 白抜きの丸 未着手
    (セッションが止まったときに途中だったタスクは − 中断)。
  - **タスクの見出し**: タスクが始まると「2/4 · 実装 (Anthropic · claude-opus) — API を足す」のような区切りが入り、
    以降の返答とツールの実行はそのタスクのものです。返答には役割の小さなチップが付きます。
  - **タスクの結果**: 終わると「実装 完了 · <まとめ>」(失敗なら赤字) の 1 行。最後に全体のまとめ (完了) が出ます。
  - 待機中に続きを指示すると、リーダーが前の計画のまとめを踏まえて新しい計画を立てます (カードがもう 1 枚出ます)。
    タスクの実行中に送った指示は、そのタスクのエージェントに渡ります。
  - 知らない種類のイベント (サーバーが将来足すもの) は表示せずに読み飛ばします。
  動いていたセッションが待機中か失敗になると、ローカル通知でお知らせします (アプリの起動中のみ)。
- **追加の指示 / 停止 / アーカイブ**: 下の入力欄から続きを指示できます (止まっているセッションは再開します)。
  アーカイブするとサンドボックスを削除し、一覧から消えます。
- **変更**: 変更されたファイル (+/− の行数) と差分を読めます。**変更を手元のワークスペースに取り込むのは PC の
  Orchestra から**行います (モバイルにはワークスペースが無いため、ここでは読むだけです)。
- PC の Orchestra から同じ Division アカウントで起動したセッションも一覧に出るので、外出先から様子を見て
  続きを指示したり止めたりできます。
- **料金**: サーバーが返すセッションごとの料金 (`costUsd`) を一覧の行と詳細の見出しに `$0.12` のように出し、
  一覧の上に表示中のセッションの合計を出します (押すとコストのページへ)。コストのページの「利用履歴」にも
  「クラウドエージェント」の欄があり、最近のセッションの料金をまとめて見られます。
- **ショートカット**: クラウドページの上の段から「プロジェクト」(Division)・「コスト」・「カンバン」を開けます
  (「戻る」でクラウドに戻ります)。カンバンと Division のプロジェクトは PC の接続が必要なので、未接続のときは
  鍵の印になり「PC に接続すると使えます」と出ます。
- **カンバンから実行** (PC 接続中): カンバンのタスクの詳細にある「クラウドで実行」から、タスクの題名・説明・
  未完了のチェックリストを指示にしてクラウドエージェントを起動できます (送る前に書き換え可)。始める場所は
  空のフォルダが既定で、「GitHub リポジトリ」を選ぶと前回クラウドで選んだリポジトリが選ばれた状態になります。
  PC で有効なプロジェクトが 1 つだけならそれが既定のプロジェクトです。作成できるとトーストに「クラウドで開く」が出て、
  押すとクラウドのページでそのセッションを開きます。カードにも「クラウドエージェントで実行を開始しました」の
  コメントを残します。

起動と追加の指示には **Orchestra Plus とクレジット** が必要です (足りなければ「コスト」→「管理」から確認できます)。
モデルの利用料金はセッションごとにかかります。Division API (`/api/cloud-sessions`) には、ほかの Division
直結の画面と同じくログイン中の Supabase JWT を Bearer トークンとして送ります。GitHub 連携
(`/api/github/status` / `connect` / `disconnect` / `repos` / `branches`) も同じです。

## チューニング (コスト・管理)

チャットでどのモデルが選ばれるかを、コストと性能の条件で調整します。

| セクション | 内容 |
| --- | --- |
| 方針 | 最低性能スコア (0〜100) / 1 回のモデル呼び出しの上限 (USD) / 割り当て可能な最大出力トークン。検証の条件は IDE 側の `AutoRouting.tsx` と同じ |
| 見積もり | 依頼文を Jev に判定させ、リーダー・コーダー・レビューの想定コストを表示 (**判定のたびに料金が発生します**)。入力トークン数は依頼文から自動で概算 |
| 利用履歴 | モデル実行ごとの実測トークン数と料金。日別 / 役割別 / モデル別の集計、見積もりとの差、リクエスト単位の合計 |
| 管理 | クレジット残高 (購入分・プラン付与分)、これまでの利用額、クレジットの増減 (Web 版だけ、Division の Web サイトのダッシュボードへのリンク) |

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
- LAN 内の直接接続は平文 HTTP なので、信頼できる LAN の中だけで使ってください。公衆 Wi-Fi では
  直接繋がず、中継 (エンドツーエンド暗号化) を使います。
- IDE 側の設定で「エージェントへの指示 / カンバン編集 / プロジェクト編集 / コマンド実行」を
  個別にオフにできます。閲覧だけ許可する運用も可能です。
- トークンが漏れたときは IDE 側で `Remote Control: Regenerate Token` を実行してください。
- Division アカウントのログインセッション (Supabase JWT) は `expo-secure-store` (iOS Keychain /
  Android Keystore) に保存され、接続情報 (`Connection`) とは別に管理されます。
- 自動検出はアカウントに紐づく `RemoteSession` テーブルの行 (LAN アドレスとトークン) を読むだけで、
  操作は LAN 直結か、外出先なら暗号化した中継経由です。中継のチャンネル名と鍵はトークンから作るので、
  トークンを知らない人は参加も解読もできません。PC は中継のリクエストでも Division の JWT を確かめます。
  ログアウトすると、その端末の行は IDE 側で削除されます。
- 共有ページに出す投稿はログイン済みユーザー全員が読めます。公開するのは役割とモデルの組み合わせだけで、
  API キーやコードは含めません。投稿の編集・削除は投稿者本人に限られます。
- Division APIはログイン中のSupabase JWTで認証します。JWTの期限が切れた場合はrefresh tokenで更新します。
- アプリでは課金しません。Plus の申し込み・クレジットの購入・支払い方法・自動チャージは Division の Web サイト
  (https://division.he-ro.io/dashboard) で管理します。ネイティブアプリ (iOS / Android) ではそのサイトへの導線も出さず、
  Web 版だけダッシュボードへのリンクを出します。
