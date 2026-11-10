# File-searcher 調査メモ（デザイン改善）

> 依頼: 「デザインを改善して」（タスク 1/11: 既存画面とデザイン資産の調査）
> 範囲: ワークスペースを読み取り専用で調査。Web 調査・ファイル変更は行っていない。`.division/goal.md` は変更していない。
> 出力: 本メモのみ新規作成。既存の `.division/FILE-SEARCH.md` は上書きしていない。

## 1. 上流成果物の有無

| 成果物 | 状態 | 根拠 |
|---|---|---|
| `.division/goal.md` | あり（最初の依頼「デザインを改善して」） | `.division/goal.md` 6-8 行 |
| `.division/paper.md` | 該当なし（検索した範囲: `.division/` 直下の一覧） | list_dir の結果に無し |
| `.division/specification.md` | 該当なし（同上） | list_dir の結果に無し |
| `.division/design/` | あり（`check-mockup.cjs`、`cloud-detail.html`、`home.html`、`index.html`、`login.html`、`navigation.html`、`orchestra-mobile-mockup.html`、`projects.html`、`remote-chat.html`、`screens.html`、`README.md`） | list_dir の結果 |
| `.division/DESIGN.html` | あり（`.division/` 直下） | list_dir の結果 |
| `.division/REVIEW.md` | あり（判定: 合格。改善指示あり） | `.division/REVIEW.md` 1, 18-30, 32-42 行 |
| `.division/FILE-SEARCH.md` | あり。ただし古い自動生成メモ（後述 §6） | `.division/FILE-SEARCH.md` 8 行にパス `/home/box/projects/Orchestra-Mobile` |
| `.division/CODER.md` / `.division/plan/continuation-map.md` / `.division/workflow.json` / `.division/projects.json` | あり（今回は未読） | list_dir の結果 |

## 2. 既存の画面構成

- **ルート**: `App.tsx` の `Shell`。タブバーなし。`stack`（`PageKey[]`）で開いているページを管理し、末尾がいま見えるページ（`App.tsx` 57-61 行）。
- **最初の画面**: `HomeScreen`（`App.tsx` 158 行）。見出しの左にドロワー（☰）。ホームの実体は `CloudAgentsScreen` の一覧（`App.tsx` 38-50 行の `PageContent` で `cloud` として描画）。
- **戻る**: Android の戻るキーを `BackHandler` で `goBack` に結びつけ（`App.tsx` 97-101 行）、`BackProvider` でページ側にも渡す（`App.tsx` 143 行）。
- **承認の帯**: ページ表示中に承認待ちなら上部に細い帯 `approvalBar` を出す（`App.tsx` 144-152 行）。配色は `bgSidebar` ＋ `warning` の点 ＋ `accentText` のリンク（`App.tsx` 194-206 行）。
- **ステータスバー**: `StatusBar style='dark'`（`App.tsx` 174 行）。明るい地に合う設定。
- **ログイン・規約**: 未ログインは `LoginScreen`、未同意は `TermsAgreementGate`（`App.tsx` 112-136 行）。
- **ページ一覧**: kanban / projects / cloud / mcp / social / tuning / actions / settings / documents（`App.tsx` 38-50 行）。画面ファイルは `src/screens/` に 1 画面 1 ファイルで存在。
- **クラウドのホーム（一覧＋入力欄）**: `src/screens/CloudAgentsScreen.tsx`（全 3317 行）。
  - 上段のショートカット: `ShortcutRow`（252-279 行）。「プロジェクト / コスト / カンバン」。PC 未接続のものは鍵アイコンと淡色にする（266-271 行）。
  - 一覧の行: `SessionRow`（286-329 行）、PC チャットの行 `PcChatRow`（339-364 行）、未接続 PC の行 `PcDeviceRow`（375 行〜）。題名と「リポジトリ · 時刻」の 2 行。
  - 入力欄: `LaunchComposer`（788-909 行）。下の横スクロールのチップ列（859-902 行）。

## 3. 入力欄のチップ（実装の実態）

`src/screens/CloudAgentsScreen.tsx` 859-902 行の順に並ぶ:

1. 送り先（`onTargetPress` があるホームのみ。クラウド / PC）: 860-867 行
2. 始める場所（`draftSourceLabel`。`warn` で注意色）: 869-875 行。非 PC のときだけ（868 行）
3. モデル（`draftModelLabel`。`warn` あり）: 876-882 行。非 PC のときだけ
4. 承認モード（`draft.modelMode === 'division'` のときだけ）: 883-890 行
5. 並列数 `×N`（`count > 1` のときだけ）: 891-893 行
6. コスト（常時）: 896-901 行

### 重要な不一致

- `docs/design-claude-style.md` の §2 と §7 は「ループ · オフ」チップを「必要時のみ表示」に実装済みと書いている。
- しかし、入力欄（780-909 行）に**ループのチップは見当たらない**。`grep` で「ループ」を検索しても、入力欄のチップとしての実装は無い。
- 733 行の注記は「繰り返し (ループ実行) と目標は、プロジェクトのワークフローの for / while ループで設定します」と書いており、入力欄から外す方向の設計になっている。
- `src/screens/__tests__/RemoteScreen.test.tsx` 98-101 行も「入力欄にループの設定は出さない」と検証している。
- 一方で `src/screens/RemoteScreen.tsx` 7 行は「目標ループの切り替え（自動 / 毎回確認）」を挙げ、`RemoteScreen.test.tsx` 4 行も同じ機能を書いている。PC 側の挙動は未確認。
- **結論**: 設計書の「ループチップ（必要時のみ表示）」は、現コードのクラウド入力欄とは一致しない。どちらが正かは要確認。Coder は設計書を信じて作業すると空振りになる。

## 4. デザイン資産（トークン）

- **`src/theme.ts`**（13-69 行）: `colors`、`withAlpha`、`spacing`（xs 4 / sm 8 / md 12 / lg 16 / xl 24）、`radius`（sm 8 / md 12 / lg 16）、`fontSize`（xs 12 / sm 15 / md 17 / lg 22 / xl 30）。
  - 値は `docs/design-claude-style.md` §3 と一致（bg `#faf9f5`、accent `#b95a3a`、onAccent `#ffffff`、accentText `#b5532f`、fg `#3d3929` など）。
  - ファイル冒頭（1-10 行）に「互換のためトークン名は従来（暗い配色のころ）のまま」とある。
- **`src/design/tokens.ts` と `src/design/theme.ts`**: ファイルは存在する（一覧より）。内容は未読。`src/theme.ts` とトークンの二重定義があるかは未確認。
- **フォント**: カスタムフォントの読み込みは無い（`docs/design-claude-style.md` 12 行）。見出し用のセリフ体は `CloudAgentsScreen.tsx` 222-224 行の `MONO` / `SERIF`（`Platform.select`）。他画面での使用は未検索。
- **UI 部品**: `src/components/ui.tsx` に `Button`、`Badge`、`ChipGroup`、`Dot`、`EmptyState`、`ErrorBanner`、`Icon`、`IconButton`、`Input`、`Loading`、`Muted`、`Row`、`Screen`、`ScreenHeader`、`SectionTitle`、`SegmentedControl`、`Sheet`、`Toggle`、`BackProvider`、`useBack`、`useToast`（`CloudAgentsScreen.tsx` 53-77 行の import より）。再利用候補。
- **画面内の部品**: `ComposerChip`、`SendButton`、`SessionRow` などは `CloudAgentsScreen.tsx` 内で定義（定義本体は未読）。`ComposerChip` と `SendButton` は `ui.tsx` に無い（import 一覧に無い）。
- **`src/components/` の他部品**: `DiscoverScreen.tsx` 9 行は「区画ごとに見出しと平らなグループ（地 bgElevated ＋細い線）」の方針。`CloudPullRequest.tsx`、`ParallelLog.tsx`、`AiLoading.tsx` などがクラウドの見た目に関わる（中身は未読）。

## 5. 視認性・余白・操作性の課題（コードから読めた範囲）

1. **入力欄のチップが横スクロール**（859 行の `ScrollView horizontal`）。6 個まで並ぶため、幅の狭い端末では右端のコストや承認モードが画面外に出る。送信ボタンは別の列（903 行）なので、チップが長くても送信は押せる。
2. **入力欄の下のチップ列は情報が多い**。既定値（送り先＝クラウド、ループ＝オフ）の表示と、本当に必要な情報の区別が無い。設計書はループ・承認・並列数を「必要時のみ」と書くが、現コードは承認・並列数は条件表示、始める場所とモデルは常時表示。
3. **無効状態の淡色**: `ShortcutRow` の無効ボタンは `fgFaint` で、地の上のコントラストが落ちる（271-272 行）。`fgFaint` 自体は 4.5:1 を保つ（`src/theme.ts` 24 行）。
4. **承認の帯の文字**: `colors.fg` に `fontSize.xs + 1`（13px）。`approvalDot` は 7px で小さい（`App.tsx` 204-206 行）。
5. **枠・影の一貫性**: `colors.shadow` は `theme.ts` 40-41 行にあるが、実際の影の使用箇所は未検索。設計書は opacity 0.06 程度と書く。
6. **サイズの不統一**: `fontSize.xs + 1` のように、トークン外の算術値が `App.tsx` や `CloudAgentsScreen.tsx` に出ている。トークン化の余地がある。
7. **HTML モックアップの二重管理**: `.division/design/index.html`（8 画面、`.device` / `.screen` 方式）と `orchestra-mobile-mockup.html`（5 画面、`.phone` / `figure` 方式）が並存（`.division/REVIEW.md` 26-28 行）。`check-mockup.cjs` は `orchestra-mobile-mockup.html` しか検査しない（`.division/REVIEW.md` 22-24 行）。
8. **README の不整合**: `.division/design/README.md` が `index.html` を成果物表に載せていない（`.division/REVIEW.md` 18-21 行）。

## 6. 既存の `.division/FILE-SEARCH.md` について

- 作業パスが `/home/box/projects/Orchestra-Mobile`（8 行）で、今のワークスペース（`/home/daytona/workspace`）と違う。
- `src/theme/tokens.ts`、`src/theme/__tests__/tokens.test.ts`、`src/components/kit.tsx`、`src/components/overlays.tsx`、`src/screens/DiscoverScreen.tsx` などの一部は、今回の list_dir の結果に無い（または別パス）。
- 「反復ファイルサーチ」の本文はキーワードの羅列で、読める要約になっていない。
- **扱い**: 事実確認に使わない。今回の根拠は本メモ §1〜§5 に示したファイルと行番号を優先する。

## 7. 既存のテスト・検証手段（実行可能性の確認）

| 手段 | 根拠 | 状態 |
|---|---|---|
| 型チェック | `package.json` の `typecheck`（`tsc --noEmit`） | 設計書は exit 0 を記録（`docs/design-claude-style.md` 16 行）。今回は未実行 |
| テスト | `package.json` の `test`（`jest`）と `jest` 設定（`testMatch` は `src/**/__tests__/**`）。設計書は `npx jest --runInBand` が必須と記録（17 行）。並列実行は Killed になる | 今回は未実行 |
| Web の書き出し | `package.json` の `build:web`（`expo export --platform web`） | 設計書は成功と記録（18 行）。今回は未実行 |
| 画面の見た目 | `.division/design/check-mockup.cjs`（playwright が無く WARN でスキップと REVIEW 記録） | 実描画は未検証 |
| 関連テスト | `src/screens/__tests__/CloudAgentsScreen.test.tsx`、`RemoteScreen.test.tsx`、`HomeScreen.test.tsx`、`src/design/__tests__/designTokens.test.ts` | 一覧に存在。中身は一部のみ確認 |

- ログイン後の画面は認証情報がないため、実機・シミュレータでの確認は未実施（`docs/design-claude-style.md` 19・144-145 行）。

## 8. 変更候補（Coder・Designer への引き継ぎ）

1. **先に決める**: 入力欄の「ループ」チップを設計通り足すのか、削除の方針（733 行の注記と RemoteScreen テスト）に合わせるのかを確定する。設計書の §2・§7 の記述は現コードと食い違うため、Writer が仕様書で整理する。
2. **入力欄**: チップの優先順位を決め、既定値のチップ（始める場所・モデル・送り先）と、変更時だけ見せるチップ（承認モード・並列数）を分ける。横スクロールで隠れる項目を減らす。
3. **トークンの重複**: `src/design/tokens.ts` / `src/design/theme.ts` と `src/theme.ts` の関係を確認し、どちらを正とするか決める。
4. **ui.tsx の再利用**: `ComposerChip` と `SendButton` は `CloudAgentsScreen.tsx` 内の定義。`ui.tsx` へ移すと他画面と統一しやすい（定義の確認が必要）。
5. **マジックナンバーの整理**: `fontSize.xs + 1` などをトークン化（`App.tsx` 205-206 行、`CloudAgentsScreen.tsx` の余白の直書き）。
6. **モックアップ**: `.division/design/` の 2 つの HTML をどちらを正とするか決め、`README.md` と `check-mockup.cjs` を揃える（`.division/REVIEW.md` 33-42 行の改善指示）。

## 9. 未確認事項（このタスクでは読んでいない）

- `src/screens/HomeScreen.tsx`、`src/screens/LoginScreen.tsx`、`src/screens/DocumentsScreen.tsx`、`src/screens/SettingsScreen.tsx` の中身。
- `src/components/ui.tsx` の各部品の定義。
- `src/design/tokens.ts`、`src/design/theme.ts` の中身。
- `.division/DESIGN.html` と `.division/design/index.html` の中身（REVIEW の記述のみ参照）。
- `.division/CODER.md`、`.division/plan/continuation-map.md`、`.division/workflow.json`。
- `src/screens/RemoteScreen.tsx` の入力欄の実装（ループ設定の有無）。

## 10. 結論（要点）

- デザイントークンは `src/theme.ts` に集約されており、`docs/design-claude-style.md` §3 と一致している。
- 既存の画面構成（ホーム＝クラウド一覧＋下部入力欄、ドロワー、ページスタック）は設計書と一致する。
- 設計書の「入力欄のループチップ」は現コードに無い。ここが最大の食い違い。
- 改善の主な対象は入力欄のチップ列（横スクロール・情報量）、トークンの二重定義、モックアップの二重管理。
