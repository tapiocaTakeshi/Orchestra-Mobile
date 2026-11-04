/**
 * Orchestra Mobile のルート定義（.division/design/index.html の data-screen に対応）。
 * React Native に依存しない純粋なモジュール（Jest で単体テスト可能）。
 *
 * 後続タスクは `owner` に書かれたファイルだけを編集すれば、
 * ルーティング側（このファイル / screenRegistry.tsx）を触らずに画面を差し替えられる。
 */

export type RouteName =
  | 'login'
  | 'home'
  | 'projects'
  | 'kanban'
  | 'quick'
  | 'mcp'
  | 'remote'
  | 'settings';

export interface RouteDef {
  name: RouteName;
  /** ヘッダー / ドロワーに出す日本語名 */
  title: string;
  /** ドロワーのアイコン（モックアップの .nav-item .ic） */
  icon: string;
  /** ドロワーの主ナビゲーションに並べるか */
  inDrawer: boolean;
  /** セッションが必要か（false は未ログインでも表示可） */
  requiresAuth: boolean;
  /** 'shell' = OrchestraApp が ShellHeader を描く / 'none' = 画面自身が描く */
  header: 'shell' | 'none';
  /** この画面の実装を担当するファイル */
  owner: string;
}

export const ROUTES: Record<RouteName, RouteDef> = {
  login: {
    name: 'login',
    title: 'ログイン',
    icon: '✻',
    inDrawer: false,
    requiresAuth: false,
    header: 'none',
    owner: 'src/screens/auth/LoginRoute.tsx',
  },
  home: {
    name: 'home',
    title: '会話',
    icon: '💬',
    inDrawer: true,
    requiresAuth: true,
    header: 'shell',
    owner: 'src/screens/HomeScreen.tsx',
  },
  projects: {
    name: 'projects',
    title: 'プロジェクト',
    icon: '📁',
    inDrawer: true,
    requiresAuth: true,
    header: 'shell',
    owner: 'src/screens/ProjectsScreen.tsx',
  },
  kanban: {
    name: 'kanban',
    title: 'カンバン',
    icon: '▦',
    inDrawer: true,
    requiresAuth: true,
    header: 'shell',
    owner: 'src/screens/KanbanScreen.tsx',
  },
  quick: {
    name: 'quick',
    title: 'クイックアクション',
    icon: '⚡',
    inDrawer: true,
    requiresAuth: true,
    header: 'shell',
    owner: 'src/screens/QuickActionsScreen.tsx',
  },
  mcp: {
    name: 'mcp',
    title: 'MCP サーバー',
    icon: '⛓',
    inDrawer: true,
    requiresAuth: true,
    header: 'shell',
    owner: 'src/screens/McpScreen.tsx',
  },
  remote: {
    name: 'remote',
    title: 'リモート接続',
    icon: '📡',
    inDrawer: true,
    // ログイン画面の「ペアリングコードで接続」から未ログインでも到達する
    requiresAuth: false,
    header: 'shell',
    owner: 'src/screens/RemoteScreen.tsx',
  },
  settings: {
    name: 'settings',
    title: '設定',
    icon: '⚙',
    inDrawer: false,
    requiresAuth: true,
    header: 'shell',
    owner: 'src/screens/SettingsScreen.tsx',
  },
};

export const ROUTE_NAMES = Object.keys(ROUTES) as RouteName[];

/** ドロワーの並び順（モックアップの .nav と同順） */
export const DRAWER_ORDER: RouteName[] = ['home', 'projects', 'kanban', 'quick', 'mcp', 'remote'];

const MAX_HISTORY = 20;

export function isRouteName(value: unknown): value is RouteName {
  return typeof value === 'string' && (ROUTE_NAMES as string[]).includes(value);
}

/** 通常の画面遷移（push）。同じ画面への連続遷移は積まない */
export function pushHistory(history: RouteName[], to: RouteName): RouteName[] {
  if (history[history.length - 1] === to) return history;
  const next = [...history, to];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

/** ドロワーからの画面選択。モックアップ同様「戻る」で会話ホームに戻る */
export function drawerHistory(to: RouteName): RouteName[] {
  return to === 'home' ? ['home'] : ['home', to];
}

/** 戻る。戻れない場合は null */
export function popHistory(history: RouteName[]): RouteName[] | null {
  if (history.length <= 1) return null;
  return history.slice(0, -1);
}

/** 認証状態に応じて表示する画面を決める */
export function resolveGuard(route: RouteName, authed: boolean): RouteName {
  if (route === 'login' && authed) return 'home';
  if (ROUTES[route].requiresAuth && !authed) return 'login';
  return route;
}

const ALIASES: Record<string, RouteName> = {
  login: 'login',
  signin: 'login',
  auth: 'login',
  home: 'home',
  chat: 'home',
  conversation: 'home',
  projects: 'projects',
  project: 'projects',
  kanban: 'kanban',
  board: 'kanban',
  quick: 'quick',
  quickactions: 'quick',
  quickaction: 'quick',
  actions: 'quick',
  mcp: 'mcp',
  mcpservers: 'mcp',
  mcpserver: 'mcp',
  remote: 'remote',
  pairing: 'remote',
  pair: 'remote',
  settings: 'settings',
  setting: 'settings',
};

/** 既存画面が react-navigation 風に呼ぶ名前（'Home', 'QuickActionsScreen' 等）を RouteName に変換 */
export function toRouteName(name: string): RouteName | null {
  const key = name
    .toLowerCase()
    .replace(/screen$/, '')
    .replace(/[^a-z]/g, '');
  return ALIASES[key] ?? null;
}
