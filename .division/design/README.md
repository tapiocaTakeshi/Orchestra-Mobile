# Orchestra Mobile — UI モックアップ

## 成果物

| ファイル | 位置づけ |
|---|---|
| `index.html` | **画面仕様の正**。8画面（`data-screen`）。単体表示と一覧表示を切り替えられ、ドロワー・シート・承認/拒否・トースト・画面遷移が動く |
| `orchestra-mobile-mockup.html` | 参考用の旧版（静的な5画面の一覧）。文言が `index.html` と違う箇所は `index.html` を優先する。今後は更新しない |
| `check-mockup.cjs` | モックの静的チェック |
| `../DESIGN.html` | デザイントークンとコンポーネント仕様 |

## 収録画面と実装先

| data-screen | 実装ファイル | 後続タスク |
|---|---|---|
| login | `src/screens/LoginScreen.tsx` | 認証・ナビゲーション |
| home | `src/screens/HomeScreen.tsx`（ドロワー・モデルシート・承認帯を含む） | 会話 |
| projects | `src/screens/ProjectsScreen.tsx` | プロジェクト |
| kanban | `src/screens/KanbanScreen.tsx` | カンバン |
| quick | `src/screens/QuickActionsScreen.tsx` | 補助画面 |
| mcp | `src/screens/McpScreen.tsx` | 補助画面 |
| remote | `src/screens/RemoteScreen.tsx` | 補助画面 |
| （8画面目） | `src/screens/SettingsScreen.tsx`（仮割当て・要確認） | 補助画面 |

画面ごとの主要要素・文言・操作の詳細は `src/design/screenMap.ts` に、トークンは `src/design/tokens.ts` にまとめています。

## 検証

    npx jest src/design                    # トークン一致・全 data-screen の割当て
    STRICT_MOCKUP=1 npx jest src/design    # 各画面ファイルにモックの必須文言があるか

実ブラウザでのスクリーンショット検証（playwright）は、実行環境にブラウザがないため未実施です。
