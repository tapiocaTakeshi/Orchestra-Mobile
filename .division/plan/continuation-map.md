# 続行地点 対応表（後続タスク向け）

> 確定値は自動生成の `.division/plan/continuation-report.md` / `.json` を正とします。
> このファイルは、レポートの読み方と、確定前の暫定的な対応・担当分割をまとめたものです。
> 再生成: `node scripts/division-survey.cjs`

## 前提
- 対象はアプリ本体（Expo / React Native の `src/`）です。モックアップの追加制作はしません。
- `.division/design/index.html` を正とします。`orchestra-mobile-mockup.html` は静的な一覧版で、参考扱いです。
- ユーザーの未コミット変更は保持します。レポート §6 の `git status` に出たファイルを編集するときは、SEARCH/REPLACE で最小限の差分だけ加えます。
- 色・フォント・余白・角丸・影は、`.division/DESIGN.html` の `:root` と同じ名前・同じ値を、RN 用のトークンに写して使います。独自の色は足しません。

## 画面対応（暫定。レポート §1 で確定）
| # | data-screen | モック | 実装先（第1候補） | 関連 lib | 主な操作 |
|---|---|---|---|---|---|
| 1 | login | LoginScreen | 認証画面（レポートの authFiles）/ `src/state/DivisionAuthContext.tsx` | divisionAuth, divisionAuthConfig | GitHub/Division でサインインして home へ、ペアリングで remote へ、規約のトースト |
| 2 | home | HomeScreen（会話） | `src/screens/HomeScreen.tsx` | divisionSession, divisionDecisions, divisionCloud, divisionBilling | ドロワー、モデル選択シート、承認・拒否バー、送信、チップのトースト |
| 3 | projects | ProjectsScreen | 新規、または既存のプロジェクト画面 | divisionProjects, divisionGitHub（GitHubRepoPicker） | 検索、セッション起動して home へ、カンバンへ、リポジトリ追加 |
| 4 | kanban | KanbanScreen | `src/screens/KanbanScreen.tsx` | divisionProjects | タブで絞り込み、タスク追加のトースト、戻る |
| 5 | quick | クイックアクション | `src/screens/DiscoverScreen.tsx` を流用するか新規（要判断） | divisionRouting | 2列グリッド（360px以下は1列）、押すと home の入力欄にプリフィル |
| 6 | mcp | MCP サーバー | 新規 | divisionMcp | スイッチの切替とトースト |
| 7 | remote | リモート接続 | 新規 | divisionSession, divisionCloud | ペアリングコードの表示 |
| 8 | （抜粋が中略され未確認） | — | レポート §1 で確定 | — | — |

## 共通部品（モックの CSS から RN に写すもの）
- Header（56px、44×44のアイコンボタン、serif 22px のページタイトル）、StatusBar はセーフエリアで代用します。
- Button: primary / secondary / ghost / danger / sm。最小高さ44、角丸 radius-md（sm は 36 と radius-sm）。
- Card（radius-lg、padding 16、shadow-1）、Badge と Dot（running / warning / success / danger）、Chip（mono 12、pill）、Tabs、Switch（44×26）。
- Drawer（幅300、bg-sidebar、scrim）、BottomSheet（上だけ radius-xl、grabber）、Toast（fg-strong 地、pill、1.8秒）。
- 文字サイズは 12 / 13 / 15 / 17 / 22 / 30 の6段階です。11px未満は使いません。

## 後続タスクの分割案
1. トークンと共通部品: レポート §4 の値を既存のテーマファイルに反映します（§2 のテーマ/トークン欄が対象。無ければ `src/design/tokens.ts` を新規作成）。§2 の「色の直書き」に出たファイルを置き換えます。
2. ナビゲーション: §2 のナビ定義に8画面を登録し、Drawer の遷移先と `aria-current` に当たる強調表示を揃えます。
3. 画面実装: §1.1 の「未反映文言」と「操作」がなくなるまで、各画面を実装します。
4. 検証: `package.json` の test / typecheck / lint を実行します（§3 の scripts に定義があるものだけ）。
