/**
 * 画面の構成。タブバーは置かず、最初の画面 (接続中はチャット、未接続は接続先の一覧) から
 * メニューでページを開き、「戻る」で最初の画面に戻る。
 */

import type { IconName } from './components/ui';

export type PageKey = 'kanban' | 'projects' | 'social' | 'tuning' | 'actions' | 'settings';

export type PageEntry = {
	key: PageKey;
	label: string;
	icon: IconName;
	/** PC に繋いでいないと開けないページ (共有とコストは Division 直結なので未接続でも開ける) */
	needsConnection: boolean;
};

/** メニューに並べる順番。 */
export const PAGES: PageEntry[] = [
	{ key: 'kanban', label: 'カンバン', icon: 'columns', needsConnection: true },
	{ key: 'projects', label: 'Division', icon: 'layers', needsConnection: true },
	{ key: 'social', label: '共有', icon: 'share-2', needsConnection: false },
	{ key: 'tuning', label: 'コスト', icon: 'bar-chart-2', needsConnection: false },
	{ key: 'actions', label: 'クイック操作', icon: 'zap', needsConnection: true },
	{ key: 'settings', label: '接続', icon: 'link', needsConnection: true },
];

export const pagesFor = (connected: boolean): PageEntry[] =>
	PAGES.filter(p => connected || !p.needsConnection);

export const canOpenPage = (key: PageKey, connected: boolean): boolean =>
	pagesFor(connected).some(p => p.key === key);
