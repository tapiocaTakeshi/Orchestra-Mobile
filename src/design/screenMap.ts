/**
 * `.division/design/index.html` の 8 画面（data-screen）と実装ファイルの対応表。
 * 画面仕様の正は index.html。orchestra-mobile-mockup.html は参考用の旧版（文言が違う箇所は index.html を優先）。
 */

export type FollowUpTask =
  | '認証・ナビゲーション'
  | '会話'
  | 'プロジェクト'
  | 'カンバン'
  | '補助画面';

export type MockAction =
  | { kind: 'navigate'; label: string; to: string; toast?: string }
  | { kind: 'toast'; label: string; toast: string }
  | { kind: 'drawer'; label: string }
  | { kind: 'sheet'; label: string }
  | { kind: 'approve' | 'deny'; label: string; toast: string }
  | { kind: 'filter'; label: string }
  | { kind: 'switch'; label: string; toast: string }
  | { kind: 'prefill'; label: string }
  | { kind: 'send'; label: string };

export interface ScreenSpec {
  /** index.html の data-screen */
  id: string;
  /** index.html の screen-label */
  mockLabel: string;
  /** 実装ファイル（リポジトリルート相対） */
  file: string;
  /** 文言が複数ファイルに分かれる画面 (会話ホームは HomeScreen が CloudAgentsScreen / RemoteScreen を埋め込む) */
  extraFiles?: string[];
  /**
   * モックにはあるがアプリに機能が無いため、STRICT_MOCKUP の文言チェックから外すもの。
   * 見た目だけのダミーは置かない方針 (機能を作ったらここから消す)。
   */
  notImplemented?: string[];
  /** ドロワー（.nav-item）での表示名。無ければ null */
  drawerLabel: string | null;
  headerType: 'none' | 'chat' | 'page-back';
  /** 主要要素（index.html の class 名で記載） */
  elements: string[];
  /** 画面に必ず出す日本語の文言（STRICT_MOCKUP=1 で検証） */
  requiredTexts: string[];
  actions: MockAction[];
  followUp: FollowUpTask;
  /** 仕様の確定度 */
  confirmed: boolean;
  note?: string;
}

export const SCREEN_MAP: ScreenSpec[] = [
  {
    id: 'login',
    mockLabel: '01 · LoginScreen',
    file: 'src/screens/LoginScreen.tsx',
    // 規約・プライバシーポリシーのリンクは LoginScreen が描く LegalLinks / TermsCheckbox にある
    extraFiles: ['src/components/TermsSheet.tsx'],
    drawerLabel: null,
    headerType: 'none',
    elements: ['statusbar', 'logo(✻ 64x64 radius-lg)', 'display(serif 30)', 'lead', 'btn-primary', 'btn-secondary', 'divider', 'btn-ghost', 'terms'],
    requiredTexts: [
      'エージェントと話す',
      'GitHub でサインイン',
      'Division アカウントで続行',
      'または',
      'ペアリングコードで接続',
      '利用規約',
      'プライバシーポリシー',
    ],
    // GitHub OAuth / Division の別アカウント導線 / ペアリングコードはアプリに無い (認証はメール+パスワードのみ)
    notImplemented: ['GitHub でサインイン', 'Division アカウントで続行', 'または', 'ペアリングコードで接続'],
    actions: [
      { kind: 'navigate', label: 'GitHub でサインイン', to: 'home', toast: 'GitHub でサインインしました' },
      { kind: 'navigate', label: 'Division アカウントで続行', to: 'home', toast: 'Division アカウントで続行' },
      { kind: 'navigate', label: 'ペアリングコードで接続', to: 'remote' },
      { kind: 'toast', label: '利用規約', toast: '利用規約シート' },
      { kind: 'toast', label: 'プライバシーポリシー', toast: 'プライバシーポリシー' },
    ],
    followUp: '認証・ナビゲーション',
    confirmed: true,
    note: '実認証は既存の src/lib/divisionAuth.ts / divisionAuthConfig.ts をそのまま使い、見た目と文言だけをモックに合わせる。',
  },
  {
    id: 'home',
    mockLabel: '02 · HomeScreen（会話）',
    file: 'src/screens/HomeScreen.tsx',
    extraFiles: ['src/screens/CloudAgentsScreen.tsx', 'src/screens/RemoteScreen.tsx', 'src/components/ui.tsx'],
    drawerLabel: '会話',
    headerType: 'chat',
    elements: [
      'header(☰ / タイトル+接続状態 / ✎)',
      'day', 'user-bubble', 'agent-turn(avatar/agent-name/badge)', 'tool-line', 'code',
      'approval(承認待ち帯: 拒否/許可)',
      'composer(textarea / chipset: クラウド・リポジトリ・モデル・コスト / send)',
      'drawer(brand / nav 6項目 / 最近の会話 / account+ログアウト)',
      'sheet(モデルを選ぶ: Opus/Sonnet/Haiku / 閉じる)',
    ],
    requiredTexts: [
      'エージェントに頼みたいことを書く…',
      'エージェント',
      '承認待ち',
      '拒否',
      '許可',
      'モデルを選ぶ',
      '閉じる',
      '最近の会話',
      'ログアウト',
    ],
    actions: [
      { kind: 'drawer', label: '☰ メニューを開く' },
      { kind: 'toast', label: '✎ 新しい会話', toast: '新しい会話を開始' },
      { kind: 'approve', label: '許可', toast: '許可しました。テストを実行します' },
      { kind: 'deny', label: '拒否', toast: '拒否しました' },
      { kind: 'sheet', label: '⚙ Opus ▾' },
      { kind: 'toast', label: '☁ クラウド ▾', toast: '実行先: クラウド / ローカルを切替' },
      { kind: 'toast', label: '⑂ orchestra-mobile ▾', toast: 'リポジトリ選択' },
      { kind: 'toast', label: '📊 $1.84', toast: '今日のコスト: $1.84' },
      { kind: 'send', label: '↑ 送信（空欄なら無効）' },
      { kind: 'navigate', label: 'ログアウト', to: 'login', toast: 'ログアウトしました' },
    ],
    followUp: '会話',
    confirmed: true,
    note: 'モデル選択後は「モデルを {model} に変更しました」とトーストを出す。承認・拒否のあとは帯を隠し、バッジを 完了 / 拒否 に変える。ドロワーとシートの実装は認証・ナビゲーションのタスクと共有する。',
  },
  {
    id: 'projects',
    mockLabel: '03 · ProjectsScreen',
    file: 'src/screens/ProjectsScreen.tsx',
    drawerLabel: 'プロジェクト',
    headerType: 'page-back',
    elements: ['header(← / page-title)', 'input(検索)', 'card(list-row / badge / meta-line mono)', 'btn-primary btn-sm', 'btn-secondary btn-sm', 'btn-secondary btn-block'],
    requiredTexts: ['プロジェクト', 'プロジェクトを検索', 'セッションを起動', 'リポジトリを追加'],
    actions: [
      { kind: 'navigate', label: '←', to: 'home' },
      { kind: 'navigate', label: 'セッションを起動', to: 'home', toast: '新しいセッションを起動しました' },
      { kind: 'navigate', label: 'カンバン', to: 'kanban' },
      { kind: 'toast', label: '＋ リポジトリを追加', toast: 'GitHub リポジトリの選択' },
    ],
    followUp: 'プロジェクト',
    confirmed: true,
    note: 'データは既存の src/lib/divisionProjects.ts / divisionGitHub.ts から取得する。状態バッジは 作業中(running) / 承認待ち(warning) / 完了(success) / エラー(danger)。',
  },
  {
    id: 'kanban',
    mockLabel: '04 · KanbanScreen',
    file: 'src/screens/KanbanScreen.tsx',
    drawerLabel: 'カンバン',
    headerType: 'page-back',
    elements: ['header(← / page-title / ＋)', 'tabs(フィルタ, 横スクロール)', 'col-h(count mono)', 'card(kcard)', 'progress'],
    requiredTexts: ['カンバン', 'すべて', '未着手', 'タスクを追加'],
    actions: [
      { kind: 'navigate', label: '←', to: 'home' },
      { kind: 'toast', label: '＋ タスクを追加', toast: 'タスクを追加' },
      { kind: 'filter', label: 'タブ（すべて / 未着手 / …）で列を絞り込む' },
    ],
    followUp: 'カンバン',
    confirmed: true,
    note: 'index.html の中略部分にタブの残りがある。ここでは「すべて 7」「未着手 2」まで確認済みで、残りのタブは index.html を直接参照して埋めること。',
  },
  {
    id: 'quick',
    mockLabel: 'QuickActionsScreen',
    file: 'src/screens/QuickActionsScreen.tsx',
    drawerLabel: 'クイックアクション',
    headerType: 'page-back',
    elements: ['header(← / page-title)', 'qa-grid(2列, 360px 以下は1列)', 'qa card(ic 36x36)'],
    requiredTexts: ['クイックアクション'],
    actions: [
      { kind: 'navigate', label: '←', to: 'home' },
      { kind: 'prefill', label: 'カードをタップすると会話ホームへ移り、入力欄に文面を入れる' },
    ],
    followUp: '補助画面',
    confirmed: true,
  },
  {
    id: 'mcp',
    mockLabel: 'McpScreen',
    file: 'src/screens/McpScreen.tsx',
    drawerLabel: 'MCP サーバー',
    headerType: 'page-back',
    elements: ['header(← / page-title)', 'card(list-row)', 'switch(aria-checked)'],
    requiredTexts: ['MCP'],
    actions: [
      { kind: 'navigate', label: '←', to: 'home' },
      { kind: 'switch', label: 'サーバーの有効/無効', toast: '{name} を有効にしました / {name} を無効にしました' },
    ],
    followUp: '補助画面',
    confirmed: true,
    note: 'データは既存の src/lib/divisionMcp.ts を使う。',
  },
  {
    id: 'remote',
    mockLabel: 'RemoteScreen',
    // モックの「リモート接続」(端末の接続・切断) はアプリでは SettingsScreen。RemoteScreen は会話ホームの PC チャット
    file: 'src/screens/SettingsScreen.tsx',
    drawerLabel: 'リモート接続',
    headerType: 'page-back',
    elements: ['header(← / page-title)', 'pair-code(44x56 mono 22 ×桁数)', 'card'],
    requiredTexts: ['リモート接続'],
    actions: [{ kind: 'navigate', label: '←', to: 'home' }],
    followUp: '補助画面',
    confirmed: true,
    note: 'ログイン画面の「ペアリングコードで接続」からもここに遷移する。',
  },
  {
    id: 'settings',
    mockLabel: '(8画面目・中略部分)',
    file: 'src/screens/SettingsScreen.tsx',
    drawerLabel: null,
    headerType: 'page-back',
    elements: ['header(← / page-title)', 'section-h', 'card', 'switch'],
    requiredTexts: [],
    actions: [{ kind: 'navigate', label: '←', to: 'home' }],
    followUp: '補助画面',
    confirmed: false,
    note: '前提: 8画面目の data-screen は中略部分にあり未確認のため、既存の SettingsScreen を仮に割り当てた。テストが未対応の ID を報告したら、ID と file をそれに合わせて直すこと。',
  },
];

/** モック側にはなく、既存アプリにだけある画面。削除せず、ドロワーの外（設定などの導線）で残す */
export const NON_MOCK_SCREENS = [
  'src/screens/DiscoverScreen.tsx',
  'src/screens/SocialScreen.tsx',
] as const;

/** ドロワーの並び順（index.html .nav） */
export const DRAWER_ORDER = ['home', 'projects', 'kanban', 'quick', 'mcp', 'remote'] as const;

/** 後続タスクごとに担当する画面 */
export const TASK_ASSIGNMENT: Record<FollowUpTask, string[]> = SCREEN_MAP.reduce(
  (acc, s) => {
    acc[s.followUp].push(s.id);
    return acc;
  },
  { '認証・ナビゲーション': [], 会話: [], プロジェクト: [], カンバン: [], 補助画面: [] } as Record<FollowUpTask, string[]>,
);
