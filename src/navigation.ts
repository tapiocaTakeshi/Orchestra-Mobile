/**
 * 画面の構成。タブバーは置かず、最初の画面 (接続中はチャット、未接続は接続先の一覧) から
 * メニューでページを開き、「戻る」で最初の画面に戻る。
 */

import type { IconName } from './components/ui';

export type PageKey = 'kanban' | 'projects' | 'cloud' | 'social' | 'tuning' | 'actions' | 'settings';

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
	{ key: 'social', label: '共有', icon: 'share-2', needsConnection: false },
	{ key: 'tuning', label: 'コスト', icon: 'bar-chart-2', needsConnection: false },
	{ key: 'actions', label: 'クイック操作', icon: 'zap', needsConnection: true },
	{ key: 'settings', label: '接続', icon: 'link', needsConnection: true },
];

/**
 * ホームのナビゲーションレールに並べるページ。コストはホームの入力欄から、クラウドはホームそのもので扱うので置かない。
 * label はレールのアイコンの下に出す短い名前、title は長押しや読み上げで使う名前。
 */
export const RAIL_PAGES: (PageEntry & { title: string })[] = [
	{ key: 'projects', label: 'Division', title: 'Division のプロジェクト管理', icon: 'layers', needsConnection: false },
	{ key: 'kanban', label: 'カンバン', title: 'カンバン', icon: 'columns', needsConnection: true },
	{ key: 'actions', label: 'UI', title: 'エディタの UI 操作', icon: 'sliders', needsConnection: true },
	{ key: 'social', label: 'ソーシャル', title: 'ソーシャル (共有)', icon: 'share-2', needsConnection: false },
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
