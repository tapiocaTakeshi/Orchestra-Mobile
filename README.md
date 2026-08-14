# Orchestra-Mobile

**Orchestra IDE のリモートコントローラー (React Native / Expo)**

手元のスマホから、PC で動いている [Orchestra](https://github.com/tapiocaTakeshi/Orchestra) を操作するアプリです。

| タブ | できること |
| --- | --- |
| 🎛 リモート | エージェントへの指示・中断、ツール実行の承認/却下、スレッド切替、エディタ操作のワンタップ実行 |
| 🗂 カンバン | `.orchestra/kanban.json` のボード閲覧・編集、カード移動、チェックリスト、コメント、タスクのエージェント実行、自動実行の ON/OFF |
| 🎭 Division | `.division/projects.json` のプロジェクト管理、役割ごとのモデル割り当て、有効化、Supabase 同期 |
| ⚙️ 接続 | 接続先の切替・解除、ワークスペースのファイルを IDE で開く |

IDE との通信 (カンバン閲覧・エージェント操作など) は **同じ LAN 内の IDE と直接** 行い、外部サーバーは
経由しません。一方、**アカウントでのログイン / 接続先の自動検出だけは Supabase (Division) を経由**します
(接続先候補の一覧を得るためだけで、操作そのものは引き続き LAN 直結です)。

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

### ディレクトリ構成

```
App.tsx                        ルート。ログイン/検出/手動接続/タブの切り替え
src/api/types.ts               IDE の remoteControlTypes.ts に対応する型
src/api/client.ts               HTTP クライアント (React 非依存 = テスト可能)
src/lib/pairing.ts             ペアリングリンク / 手入力の解釈
src/lib/connect.ts             接続候補の検証 (ping→state→connect) の共通ロジック
src/lib/divisionAuthConfig.ts  Division (Supabase) の公開設定
src/lib/divisionAuth.ts        Division ログイン・RemoteSession 一覧取得・購読
src/lib/divisionSession.ts     Division セッションの secure-store 永続化
src/lib/kanban.ts              ボードの絞り込み・集計 (UI 非依存)
src/lib/format.ts              相対時刻や表示名の整形
src/state/AppContext.tsx       接続情報の保持と /api/state のポーリング
src/state/DivisionAuthContext.tsx  Division ログイン状態 + 新規セッション通知
src/state/storage.ts           AsyncStorage への保存 (接続情報のみ)
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
