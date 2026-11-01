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

// 接続状態はテストごとに差し替える (既定は未接続)
type MockApp = {
	connection: { label: string } | null;
	connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'lost';
	connectionRoute?: 'lan' | 'relay' | null;
	snapshot: null;
	disconnect: jest.Mock;
};
const mockDisconnected = (): MockApp => ({ connection: null, connectionStatus: 'disconnected', connectionRoute: null, snapshot: null, disconnect: jest.fn() });
let mockApp: MockApp = mockDisconnected();
jest.mock('../../state/AppContext', () => ({
	useApp: () => mockApp,
}));

const mockLogout = jest.fn();
jest.mock('../../state/DivisionAuthContext', () => ({
	useDivisionAuth: () => ({
		session: {
			userId: 'user-1',
			email: 'me@example.com',
			accessToken: 'access-token',
			refreshToken: 'refresh-token',
		},
		logout: mockLogout,
	}),
}));

const mockToastShow = jest.fn();
const mockConfirm = jest.fn(async () => true);
jest.mock('../../components/ui', () => {
	const actual = jest.requireActual('../../components/ui');
	return {
		...actual,
		useToast: () => ({ show: mockToastShow }),
		// Modal はテストレンダラーのツリーに出ないので、シートの中身をその場に描く
		Sheet: ({ title, children }: { title: string; children: React.ReactNode }) => {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const R = require('react') as typeof React;
			return R.createElement(R.Fragment, null, R.createElement('Text', null, title), children);
		},
		confirmAction: (...args: unknown[]) => (mockConfirm as unknown as (...a: unknown[]) => Promise<boolean>)(...args),
	};
});

// 本文はドロワーのテストには関係ないので、headerTitle (☰ と見出し) をそのまま出すだけのスタブ。
// PC のチャットを混ぜる一覧として渡されているか (onOpenPcChat) だけ覚えておく
const mockCloudProps: { onOpenPcChat?: () => void }[] = [];
jest.mock('../CloudAgentsScreen', () => ({
	CloudAgentsScreen: (props: { headerTitle?: React.ReactNode; onOpenPcChat?: () => void }) => {
		mockCloudProps.push(props);
		return <>{props.headerTitle}</>;
	},
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
let onPcChatOpenChange: jest.Mock;

const render = async (): Promise<ReactTestRenderer> => {
	onOpenPage = jest.fn();
	onPcChatOpenChange = jest.fn();
	await act(async () => {
		renderer = create(
			React.createElement(HomeScreen, { pcChatOpen: false, onPcChatOpenChange, onOpenPage }),
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
	mockCloudProps.length = 0;
	mockApp = mockDisconnected();
});

describe('HomeScreen の一覧 (クラウドと PC を混ぜる)', () => {
	it('クラウドの一覧に PC のチャットを混ぜて出し、未接続 (既定) では見出しに接続状態を出さない', async () => {
		const r = await render();
		expect(findTextNode(r.root, 'Orchestra')).toBeTruthy();
		// 未接続はクラウドだけで使う既定の状態なので、見出しは題名だけ (主操作の邪魔をしない)
		expect(findTextNode(r.root, 'PC に未接続')).toBeUndefined();
		// モードの切り替えは無くなった
		expect(findTextNode(r.root, 'リモートコントロール')).toBeUndefined();
		const props = mockCloudProps[mockCloudProps.length - 1];
		expect(typeof props.onOpenPcChat).toBe('function');
		await act(async () => { props.onOpenPcChat!(); });
		expect(onPcChatOpenChange).toHaveBeenCalledWith(true);
	});
});

describe('HomeScreen の見出しの接続状態 (必要なときだけ出す)', () => {
	it('手元のネットワークで接続済み (正常) なら出さない', async () => {
		mockApp = { ...mockDisconnected(), connection: { label: 'MyPC' }, connectionStatus: 'connected', connectionRoute: 'lan' };
		const r = await render();
		expect(findTextNode(r.root, '接続済み · MyPC')).toBeUndefined();
	});

	it('接続中と外出先 (中継) での接続は状態だけ出す', async () => {
		mockApp = { ...mockDisconnected(), connection: { label: 'MyPC' }, connectionStatus: 'connecting' };
		let r = await render();
		expect(findTextNode(r.root, '接続中 · MyPC')).toBeTruthy();
		await act(async () => { r.unmount(); });
		renderer = null;

		mockApp = { ...mockDisconnected(), connection: { label: 'MyPC' }, connectionStatus: 'connected', connectionRoute: 'relay' };
		r = await render();
		expect(findTextNode(r.root, '接続済み (外出先) · MyPC')).toBeTruthy();
	});

	it('接続切れは見出しに出し、押すと接続の設定 (復旧の入口) を開く', async () => {
		mockApp = { ...mockDisconnected(), connection: { label: 'MyPC' }, connectionStatus: 'lost' };
		const r = await render();
		expect(findTextNode(r.root, '接続切れ · MyPC · 押して再接続')).toBeTruthy();
		await press(findButtonsByLabel(r.root, '接続切れ。接続の設定を開いて再接続する')[0]);
		expect(onOpenPage).toHaveBeenCalledWith('settings' satisfies PageKey);
	});
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
		// 主要画面 (ページ) と補助機能 (設定) を分け、各行に 1 行の説明を出す
		expect(findTextNode(r.root, 'ページ')).toBeTruthy();
		expect(findTextNode(r.root, '設定')).toBeTruthy();
		expect(findTextNode(r.root, 'PC のエディタを端末から操作')).toBeTruthy();
		expect(findTextNode(r.root, 'PC との接続')).toBeTruthy();
		expect(findTextNode(r.root, 'PC に未接続')).toBeTruthy();
		expect(findTextNode(r.root, 'コストの方針と残高')).toBeTruthy();
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

	it('「設定」のコストはドロワーから 1 タップで開く (ホームから 2 タップ)', async () => {
		const r = await render();
		await press(findButtonsByLabel(r.root, 'ナビゲーションドロワーを開く')[0]);
		await press(findRowByTitle(r.root, 'コストの方針と残高'));
		expect(onOpenPage).toHaveBeenCalledWith('tuning' satisfies PageKey);
		expect(findTextNode(r.root, DRAWER_ONLY_TEXT)).toBeUndefined();
	});

	it('未接続の「PC との接続」は接続の仕方を案内し、接続済みなら接続の設定を開いて現在の状態を出す', async () => {
		let r = await render();
		await press(findButtonsByLabel(r.root, 'ナビゲーションドロワーを開く')[0]);
		await press(findRowByTitle(r.root, 'PC との接続'));
		expect(onOpenPage).not.toHaveBeenCalled();
		expect(mockToastShow).toHaveBeenCalledWith('ホームの一覧に出る PC を押すと接続できます', 'info');
		await act(async () => { r.unmount(); });
		renderer = null;

		mockApp = { ...mockDisconnected(), connection: { label: 'MyPC' }, connectionStatus: 'connected', connectionRoute: 'lan' };
		r = await render();
		await press(findButtonsByLabel(r.root, 'ナビゲーションドロワーを開く')[0]);
		expect(findTextNode(r.root, '接続済み · MyPC')).toBeTruthy();
		await press(findRowByTitle(r.root, 'PC との接続'));
		expect(onOpenPage).toHaveBeenCalledWith('settings' satisfies PageKey);
	});

	it('アカウントからのログアウトは確認を挟み、キャンセルすればログアウトしない (取り消し手段)', async () => {
		const r = await render();
		await press(findButtonsByLabel(r.root, 'ナビゲーションドロワーを開く')[0]);
		await press(findButtonsByLabel(r.root, 'アカウント me@example.com')[0]);
		mockConfirm.mockResolvedValueOnce(false);
		await press(findRowByTitle(r.root, 'ログアウト'));
		expect(mockConfirm).toHaveBeenCalledTimes(1);
		expect(mockLogout).not.toHaveBeenCalled();
	});
});
