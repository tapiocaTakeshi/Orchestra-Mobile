/**
 * 画面の構成。タブバーは置かず、最初の画面 (接続中はチャット、未接続は接続先の一覧) から
 * メニューでページを開き、「戻る」で最初の画面に戻る。
 */

import type { IconName } from './components/ui';

export type PageKey = 'kanban' | 'projects' | 'cloud' | 'mcp' | 'social' | 'tuning' | 'actions' | 'settings';

export type PageEntry = {
	key: PageKey;
	label: string;
	icon: IconName;
	/**
	 * PC に繋いでいないと開けないページ。
	 * クラウド・共有・コストは Division 直結、Division のプロジェクト管理は
	 * Division API (Web のディビジョンプロジェクトと同じ一覧) を読むので、未接続でも開ける。
	 */
	needsConnection: boolean;
};

/** メニューに並べる順番。 */
export const PAGES: PageEntry[] = [
	{ key: 'kanban', label: 'カンバン', icon: 'columns', needsConnection: true },
	{ key: 'projects', label: 'Division', icon: 'layers', needsConnection: false },
	{ key: 'cloud', label: 'クラウド', icon: 'cloud', needsConnection: false },
	{ key: 'mcp', label: 'MCP', icon: 'package', needsConnection: false },
	{ key: 'social', label: '共有', icon: 'share-2', needsConnection: false },
	{ key: 'tuning', label: 'コスト', icon: 'bar-chart-2', needsConnection: false },
	{ key: 'actions', label: 'クイック操作', icon: 'zap', needsConnection: true },
	{ key: 'settings', label: '接続', icon: 'link', needsConnection: true },
];

/**
 * ドロワーの 1 行。title は行に出す名前 (読み上げにも使う)、detail は名前の下に出す 1 行の説明
 * (名前だけでは中身が分かりにくいページの入口を明確にする)。label は短い名前。
 */
export type DrawerPage = PageEntry & { title: string; detail: string };

/**
 * ホームのナビゲーションドロワーの「ページ」(主要画面)。クラウドはホームそのもので扱うので置かない。
 */
export const DRAWER_PAGES: DrawerPage[] = [
	{ key: 'projects', label: 'Division', title: 'Division のプロジェクト管理', detail: 'プロジェクトとタスクの割り当て', icon: 'layers', needsConnection: false },
	{ key: 'mcp', label: 'MCP', title: 'MCP (ストア・サーバー設定)', detail: 'エージェントが使うツールを追加', icon: 'package', needsConnection: false },
	{ key: 'kanban', label: 'カンバン', title: 'カンバン', detail: 'PC のタスクを列で管理', icon: 'columns', needsConnection: true },
	{ key: 'actions', label: 'UI', title: 'エディタの UI 操作', detail: 'PC のエディタを端末から操作', icon: 'sliders', needsConnection: true },
	{ key: 'social', label: 'ソーシャル', title: 'ソーシャル (共有)', detail: '共有されたプロンプトやセッション', icon: 'share-2', needsConnection: false },
];

/**
 * ドロワーの「設定」(補助機能)。主要画面とは区切って下に置く。
 * ホームの見出しから外した接続状態と、入力欄から外したコストの入口をここに集め、
 * どちらもドロワーから 1 タップ (ホームから 2 タップ) で開けるようにする。
 * detail は既定の説明で、接続は表示時に現在の接続状態で置き換える。
 */
export const DRAWER_SETTINGS_PAGES: DrawerPage[] = [
	{ key: 'settings', label: '接続', title: 'PC との接続', detail: 'PC に繋ぐとカンバンや UI 操作が使えます', icon: 'link', needsConnection: true },
	{ key: 'tuning', label: 'コスト', title: 'コストの方針と残高', detail: '見積もり・料金・残高', icon: 'bar-chart-2', needsConnection: false },
];

export const pagesFor = (connected: boolean): PageEntry[] =>
	PAGES.filter(p => connected || !p.needsConnection);

export const canOpenPage = (key: PageKey, connected: boolean): boolean =>
	pagesFor(connected).some(p => p.key === key);

/** ページの中から別のページを開くときのオプション。 */
export type OpenPageOptions = {
	/** クラウドのページを開いたら、このセッションの詳細をすぐ開く */
	cloudSessionId?: string;
};

/**
 * ページを開く。最初の画面のメニューから開くとそのページだけになり、ページの中から開くと
 * 重ねて開く (「戻る」で元のページへ戻る)。
 */
export type OpenPage = (page: PageKey, options?: OpenPageOptions) => void;

/**
 * ページの中から別のページを開いたときの重なり。同じページが既に下にあれば、そこまで戻す
 * (クラウド → カンバン → 「クラウドで開く」で、クラウドが 2 枚重ならないように)。
 */
export const pushPage = (stack: PageKey[], page: PageKey): PageKey[] => {
	const index = stack.indexOf(page);
	return index >= 0 ? stack.slice(0, index + 1) : [...stack, page];
};
