# Orchestra Mobile — UX改善デザイン

## 開く順序

1. **`index.html`** — 改善設計の正本。Visual ThemeからAgent Prompt Guideまでの必須9章、改善前後、配色・文字・余白、状態、focus、画面wireframe、実装promptを収録。ワークスペース直下の `../../.division/design/index.html` は同じ内容の閲覧用ミラーで、画面リンクのみ相対位置を調整する。設計判断はこの正本だけへ差分更新する。
2. **主要画面HTML** — 通常表示と失敗・切断などの代表状態を示す自己完結モック。各ページに改善前後、遷移、操作、focusの実装仕様を併記。
3. **`screens.html`** — 従来の7画面統合モックをそのまま保全した資料。ドロワー・シート・承認／拒否・toast・画面切替を操作できる。旧ログインを含むため、新規実装の文言・操作は1と2を優先。
4. **`orchestra-mobile-mockup.html`** — 旧版の静的5画面。参考資産として維持し、今後の正本にはしない。

## 主要画面

| ファイル | 対象 | 主な改善 |
|---|---|---|
| `login.html` | LoginScreen | 実装済みのメール＋パスワードのみ、入力補助、認証中の重複防止、失敗時のメール保持とfocus |
| `home.html` | HomeScreen / CloudAgentsScreen | 進行中・承認待ちの優先表示、PC新規チャットのthreadId保持・同一本文再送、loading/empty/errorの排他表示 |
| `cloud-detail.html` | クラウド会話詳細 | 承認・継続待ちの明示、pendingActionによる操作種別・引数保持、空入力の目標継続再試行、古いerror解除 |
| `remote-chat.html` | RemoteScreen | 最終受信内容・draft保持、4種の接続状態・経路表示、inline error、同一本文の再試行 |
| `projects.html` | ProjectsScreen | 検索・一覧状態、保存／削除の進行と失敗、projectId・name・agentsを保持した再保存、focus復帰 |
| `navigation.html` | Drawer / page stack | Android戻る、Mobile／Webの違い、overlayの優先順位、focusとscroll位置の復帰 |

いずれも新しいAPI・機能を追加する仕様ではなく、既存画面・認証・接続・保存処理へ適用するUX設計です。詳細な受け入れ条件は `../specification.md`、実装対応は `src/design/screenMap.ts` を参照します。

## 既存7画面の対応

`index.html` と `screens.html` には、実装テストが参照する `login / home / projects / kanban / quick / mcp / remote` の `data-screen` を保持しています。`remote` は既存のリモート接続設定を表し、会話の改善詳細は別資料 `remote-chat.html` に記載しています。

## 設計上の判断

- 主タスクは「指示を送り、進行と承認を把握する」。成功指標は通常送信2操作、失敗後の再試行1操作。
- 常設sidebar、重複banner、競合する主操作を増やさず、詳細設定・診断・危険操作は必要時に表示する。
- 接続・実行・失敗は色だけでなく文字で示す。再試行可能な失敗はtoastで消さずinline errorを残す。
- 色・spacing・radiusは既存 `src/design/tokens.ts` と一致するため維持。全新規ページは同じ `:root` とdark modeを持つ。
- タッチ目標はReact NativeのPressable自体を44×44pt以上、Webを44×44px以上にする。hitSlopだけで実寸を担保せず、隣接する操作枠を重ねない。
- 上流の `paper.md` に実測所見はないため、実装確認と仕様要件を根拠にした設計であり、利用者テスト結果ではない。
- レビューISS-04/07/08を反映し、再試行はcanSendや現在のdraftに依存させず、失敗した操作の種別・引数を保持する。draft編集・対象操作成功・別操作成功で古いerrorを解除し、pollingや再接続で自動再送しない。
- タスク12ではレビューISS-09/10/12/14を反映。PC新規送信はnewThread成功後のthreadIdを保持し、sendPrompt失敗後は同じthreadId・本文だけを再送する。再試行・再接続は実寸44×44pt以上とし、sendable=falseや切断時は無効ボタンを置かず、不能理由と次の有効操作を示す。クラウド継続の回復はcomposer直上のinline errorに一本化する。
- FR-008の文書・カンバン・共有・コストはloading/empty/success/errorと回復操作を共通表で設計した。既存画面構造・認証・API・配色・spacing・radius・7画面IDは、後方互換性と既存操作維持のため変更しない。

## 検証

```sh
cd Orchestra-Mobile
node .division/design/check-mockup.cjs
npx jest src/design --runInBand
```

`check-mockup.cjs` は新規ページのDOCTYPE・lang・viewport・inline style・トークン一致・dark mode・必須9章・画面ID・リンク先・外部依存なし・30,000 bytes以内を検査します。`screens.html` は既存モック保全のためサイズ上限の対象外、旧版のページ内擬似リンクは参考資料として対象外です。Playwrightが利用できる場合は320/360/390pxの横scrollとスクリーンショットも検査します。

検査結果は実行したタスクごとに追記し、過去の合格数を現在の証跡として使いません。以前記載した「Jest 2 suites・9 tests」と「Chromium 70通り」は、現在の変更に対する再現可能な証跡がないため検証根拠から除外しました。

モックHTMLの描画結果はアプリ実装の受け入れ証跡ではありません。実機・シミュレータの画面幅・キーボード、VoiceOver／TalkBack、最終配色のコントラスト、利用者テストは、個別に証跡を得るまで未検証です。以前のJest全体終了コード1はCoder担当がタスク9で修正し、タスク10のレビューでは終了コード0と記録されています。ここで報告するデザイン用Jestの結果は、アプリ全体の検証結果と混同しません。

### 今回の検証（タスク12/14）

- `node .division/design/check-mockup.cjs`: 終了コード0、静的検査 OK 34 / NG 0。Playwright未導入のため同スクリプトの描画検査はWARN 1。
- `npx jest src/design --runInBand`: 終了コード0、2 suites合格、9 tests合格・1 skipped。
- システムChromium 137をCDPで直接操作し、正本index・主要6画面・screens・直下mirror indexの9ページについて、320/360/390/768/1024px・light/darkの90通りを新規測定。全てdocumentの横方向overflowなし、dark媒体クエリ一致、重複IDなし。
- 直下mirrorの全15リンク先を確認し、正本注記・画面リンクprefixを正規化した本文が正本indexと完全一致することを確認。
- `git diff --check`: 終了コード0。
- 実機のキーボード・タッチ実寸、VoiceOver／TalkBack、コントラスト、利用者テスト、スクリーンショット目視、アプリ全体のJestは今回も未検証。

### 今回の検証（タスク8/14）

- `node .division/design/check-mockup.cjs`: 終了コード0、静的検査 OK 34 / NG 0。Playwright未導入のため同スクリプトの描画検査はWARN 1。
- `npx jest src/design --runInBand`: 終了コード0、2 suites合格、9 tests合格・1 skipped。
- システムChromium 137をCDPで直接操作し、正本index・主要6画面・直下mirror indexの8ページについて、320/360/390/768/1024px・light/darkの80通りを測定。全てdocumentの横方向overflowなし、dark媒体クエリ一致。これは今回実行した新規測定で、旧「70通り」の引用ではない。
- 今回変更した正本5ページと直下mirrorで、重複IDなし、inline style 1個、form controlのlabel対応、外部assetなしを確認。
- 実機のキーボード・タッチ実寸、VoiceOver／TalkBack、コントラスト、利用者テスト、スクリーンショット目視は未検証。アプリのJest全体終了コードも今回の対象外で、既存の終了問題を合格扱いしない。

## 変更履歴

- 2026-11-08: UX改善仕様に基づき、入口を9章のデザインシステムへ差分更新し、6画面の実装可能な状態・操作・遷移設計を追加。既存統合モックを `screens.html` へ保全し、旧版は参考資料として維持。既存7画面IDとトークンは互換性のため維持。
- 2026-11-08: タスク8/14。レビュー指摘を反映し、クラウド継続・PC送信・プロジェクト保存の再試行対象とerror解除条件、接続状態の文字表現、44pt実寸を具体化。直下の作業報告を正本の閲覧用ミラーへ置き換え、再現不能な旧検証数を除外。
- 2026-11-08: タスク12/14。ISS-09/10/12/14とFR-008を反映し、PC新規チャットのthreadId保持再送、44pt再試行操作、再試行不能時の次操作、文書・カンバン・共有・コストの状態を追加。継続回復をinline errorへ一本化し、互換性のため既存トークン・画面ID・遷移を維持。
