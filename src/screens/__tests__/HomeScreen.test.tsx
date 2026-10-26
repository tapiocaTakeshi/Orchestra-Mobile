/**
 * HomeScreen のナビゲーションドロワーの回帰テスト。
 *
 * かつての常設ナビゲーションレールを、開閉できるドロワーに置き換えたことを確認する:
 *  - 初期状態ではドロワーは完全に非表示 (アイコン・ラベルとも描かれず、レールの幅・余白も残らない)
 *  - ☰ ボタンでドロワーが開き、項目が表示される
 *  - 「メニューを閉じる」でドロワーが完全に閉じる
 *  - 項目を押すと onOpenPage (ページ遷移) が呼ばれ、ドロワーは閉じる
 *  - PC 接続が要る項目は鍵付きで、押しても遷移せず案内 (トースト) を出す
 *
 * 外部依存はモックで切り離す:
 *  - `useApp` … 未接続 (connection / snapshot が null) を注入。
 *  - `useDivisionAuth` … ログイン済みセッションを注入。
 *  - 本文の各画面 (Cloud / Remote / Discover) … このテストの関心はドロワーだけなので軽量スタブ。
 */

import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import type { PageKey } from '../../navigation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// --- 外部依存のモック --------------------------------------------------------

jest.mock('../../state/AppContext', () => ({
	useApp: () => ({
		connection: null,
		connectionStatus: 'disconnected',
		snapshot: null,
		disconnect: jest.fn(),
	}),
}));

jest.mock('../../state/DivisionAuthContext', () => ({
	useDivisionAuth: () => ({
		session: {
			userId: 'user-1',
			email: 'me@example.com',
			accessToken: 'access-token',
			refreshToken: 'refresh-token',
		},
		logout: jest.fn(),
	}),
}));

const mockToastShow = jest.fn();
jest.mock('../../components/ui', () => {
	const actual = jest.requireActual('../../components/ui');
	return {
		...actual,
		useToast: () => ({ show: mockToastShow }),
		confirmAction: jest.fn(async () => true),
	};
});

// 本文はドロワーのテストには関係ないので、headerTitle (☰ とモード切り替え) をそのまま出すだけのスタブ
jest.mock('../CloudAgentsScreen', () => ({
	CloudAgentsScreen: ({ headerTitle }: { headerTitle?: React.ReactNode }) => <>{headerTitle}</>,
}));

// モックを差し込んだうえで、テスト対象の画面を読み込む
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { HomeScreen } = require('../HomeScreen') as typeof import('../HomeScreen');

// --- ヘルパー ----------------------------------------------------------------

/** 葉のテキストノード (子が全部文字列) を探す。 */
const findTextNode = (root: ReactTestInstance, text: string): ReactTestInstance | undefined =>
	root
		.findAll(
			node =>
				node.children.length > 0 &&
				node.children.every(c => typeof c === 'string') &&
				node.children.join('') === text,
			{ deep: true },
		)[0];

/** 表示テキストから祖先を辿って、押せる行 (onPress を持つノード) を見つける。 */
const findRowByTitle = (root: ReactTestInstance, title: string): ReactTestInstance => {
	const textNode = findTextNode(root, title);
	if (!textNode) throw new Error(`テキスト「${title}」が見つかりません。`);
	let cur: ReactTestInstance | null = textNode.parent;
	while (cur) {
		if (typeof cur.props?.onPress === 'function') return cur;
		cur = cur.parent;
	}
	throw new Error(`「${title}」を含む押せる行が見つかりません。`);
};

/**
 * ラベルの付いた押せるノード (ホスト要素) を探す。
 * findAllByProps だと IconButton や Pressable などラベルを子に伝播させるラッパにも当たり、
 * onPress が二重に呼ばれるので、実際にクリックを受けるホスト要素 (DOM 側の button) に絞る。
 */
const findButtonsByLabel = (root: ReactTestInstance, label: string): ReactTestInstance[] =>
	root.findAll(node => {
		if (node.props?.accessibilityLabel !== label || typeof node.props?.onPress !== 'function') return false;
		// 一番外側 (ラベルを持って onPress を呼べる最初の層) だけを返す
		const parent = node.parent;
		return !(parent?.props?.accessibilityLabel === label && typeof parent.props?.onPress === 'function');
	});

let renderer: ReactTestRenderer | null = null;
let onOpenPage: jest.Mock;

const render = async (): Promise<ReactTestRenderer> => {
	onOpenPage = jest.fn();
	await act(async () => {
		renderer = create(
			React.createElement(HomeScreen, { mode: 'cloud', onModeChange: jest.fn(), onOpenPage }),
		);
	});
	return renderer!;
};

/** ドロワー内にしか出ないテキストで、開閉の判定に使う。 */
const DRAWER_ONLY_TEXT = 'Division のプロジェクト管理';

/** ボタン (ホスト要素) でも行 (onPress を持つコンポーネント) でも押せるようにする。 */
const press = async (node: ReactTestInstance) => {
	await act(async () => {
		const props = node.props as { onPress?: (e: unknown) => void; onClick?: (e: unknown) => void };
		// react-native-web の onClick はイベントを参照するので、最小限のダミーを渡す
		const event = { stopPropagation: () => undefined, preventDefault: () => undefined };
		(props.onPress ?? props.onClick)?.(event);
	});
};

afterEach(async () => {
	if (renderer) {
		await act(async () => {
			renderer!.unmount();
		});
		renderer = null;
	}
	jest.clearAllMocks();
});

// --- テスト ------------------------------------------------------------------

describe('HomeScreen のナビゲーションドロワー', () => {
	it('初期状態ではドロワーは完全に非表示で、開くための ☰ ボタンだけがある', async () => {
		const r = await render();
		// ドロワーの項目もアカウント欄も描かれていない (折りたたみレールのような残りも無い)
		expect(findTextNode(r.root, DRAWER_ONLY_TEXT)).toBeUndefined();
		expect(findTextNode(r.root, 'メニュー')).toBeUndefined();
		expect(findTextNode(r.root, 'me@example.com')).toBeUndefined();
		// 開く操作は画面上に常にある
		expect(findButtonsByLabel(r.root, 'ナビゲーションドロワーを開く')).toHaveLength(1);
	});

	it('☰ ボタンでドロワーが開き、ページの項目とアカウントが表示される', async () => {
		const r = await render();
		await press(findButtonsByLabel(r.root, 'ナビゲーションドロワーを開く')[0]);

		expect(findTextNode(r.root, 'メニュー')).toBeTruthy();
		// DRAWER_PAGES の全項目 (ソーシャルは未接続でも開ける)
		expect(findTextNode(r.root, DRAWER_ONLY_TEXT)).toBeTruthy();
		expect(findTextNode(r.root, 'カンバン')).toBeTruthy();
		expect(findTextNode(r.root, 'エディタの UI 操作')).toBeTruthy();
		expect(findTextNode(r.root, 'ソーシャル (共有)')).toBeTruthy();
		expect(findTextNode(r.root, 'me@example.com')).toBeTruthy();
		// ドロワーの中からも閉じられる (パネル右上のボタンと、背景のスクリム)
		expect(findButtonsByLabel(r.root, 'メニューを閉じる').length).toBeGreaterThanOrEqual(1);
	});

	it('「メニューを閉じる」でドロワーが完全に非表示に戻る', async () => {
		const r = await render();
		await press(findButtonsByLabel(r.root, 'ナビゲーションドロワーを開く')[0]);
		await press(findButtonsByLabel(r.root, 'メニューを閉じる')[0]);

		expect(findTextNode(r.root, DRAWER_ONLY_TEXT)).toBeUndefined();
		expect(findTextNode(r.root, 'me@example.com')).toBeUndefined();
	});

	it('未接続でも開ける項目を押すとページに移り、ドロワーは閉じる', async () => {
		const r = await render();
		await press(findButtonsByLabel(r.root, 'ナビゲーションドロワーを開く')[0]);
		await press(findRowByTitle(r.root, 'ソーシャル (共有)'));

		expect(onOpenPage).toHaveBeenCalledWith('social' satisfies PageKey);
		expect(onOpenPage).toHaveBeenCalledTimes(1);
		// 移ったあとドロワーは完全に閉じている
		expect(findTextNode(r.root, DRAWER_ONLY_TEXT)).toBeUndefined();
	});

	it('PC 接続が要る項目は鍵の案内を出すだけで、遷移せずドロワーも閉じない', async () => {
		const r = await render();
		await press(findButtonsByLabel(r.root, 'ナビゲーションドロワーを開く')[0]);
		await press(findRowByTitle(r.root, 'カンバン'));

		expect(onOpenPage).not.toHaveBeenCalled();
		expect(mockToastShow).toHaveBeenCalledWith('カンバンは PC に接続すると使えます', 'info');
		// ドロワーは開いたまま (案内を見て別の項目を選べる)
		expect(findTextNode(r.root, DRAWER_ONLY_TEXT)).toBeTruthy();
	});
});
