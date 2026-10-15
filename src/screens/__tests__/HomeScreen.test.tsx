/**
 * HomeScreen のナビゲーションドロワーの回帰テスト。
 *
 * ナビゲーションレールの代わりに入れたドロワーが、
 *  - 閉じている (初期状態) ときは項目・閉じる操作・占有領域を一切残さない (アンマウント)
 *  - 見出しの「メニューを開く」で開き、中の ‹ / 外側の暗い部分で閉じられる
 *  - 項目を選ぶとドロワーを閉じてからページ遷移する
 *  - PC 接続が要る項目は未接続では遷移せず案内を出す
 * ことを確認する。
 *
 * 外部依存はモックで切り離す (実装の書き写しではなく、画面の振る舞いを検証するため):
 *  - 子画面 (CloudAgentsScreen / RemoteScreen / DiscoverScreen):
 *    クラウド API・ポーリング・WebSocket を抱えるため、渡された headerLeft / headerTitle を
 *    そのまま見出しに出す軽量スタブに差し替える (ドロワーの検証には子画面の中身は不要)。
 *  - `useApp` / `useDivisionAuth`: 実プロバイダは Supabase・通知・ポーリングを抱えるため、
 *    未接続・ログイン済みのコンテキスト値を直接注入する。
 *  - Feather アイコン / SafeAreaView: ESM 依存で ts-jest 変換できないため軽量スタブ。
 */

import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import type { PageKey } from '../../navigation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// --- 外部依存のモック --------------------------------------------------------

// react-native-web の Modal は createPortal で DOM に描画するため react-test-renderer では中身が見えない。
// visible のときだけ子要素をその場に描くスタブにして、開閉 (マウント/アンマウント) を検証できるようにする。
jest.mock('react-native', () => {
	const actual = jest.requireActual('react-native');
	return {
		...actual,
		Modal: ({ visible = true, children }: { visible?: boolean; children?: React.ReactNode }) => (visible ? children : null),
		// Image は node 環境では window.Image が無く読み込みで落ちるため、何も描かないスタブにする (ロゴ画像の検証は対象外)。
		Image: () => null,
	};
});

const mockShow = jest.fn();
jest.mock('../../components/ui', () => {
	const actual = jest.requireActual('../../components/ui');
	return {
		...actual,
		useToast: () => ({ show: mockShow, hide: jest.fn() }),
		// ToastHost は ui.tsx 内部の useToast (ToastProvider が必要) を使うため、空のスタブにする。
		ToastHost: () => null,
	};
});

jest.mock('../../state/AppContext', () => ({
	useApp: () => ({ connection: null, snapshot: null, disconnect: jest.fn() }),
}));

jest.mock('../../state/DivisionAuthContext', () => ({
	useDivisionAuth: () => ({
		session: { userId: 'user-1', email: 'me@example.com', accessToken: 'a', refreshToken: 'r' },
		logout: jest.fn(),
	}),
}));

// 子画面は「渡されたヘッダーを出すだけ」のスタブ。headerLeft が見出しの左に来ることもここで保証する。
jest.mock('../CloudAgentsScreen', () => ({
	CloudAgentsScreen: ({ headerTitle, headerLeft }: { headerTitle?: React.ReactNode; headerLeft?: React.ReactNode }) =>
		React.createElement(
			'View',
			{ testID: 'content' },
			React.createElement('View', { testID: 'header-left' }, headerLeft),
			headerTitle,
		),
}));
jest.mock('../RemoteScreen', () => ({
	RemoteScreen: () => React.createElement('View', { testID: 'content' }),
}));
jest.mock('../DiscoverScreen', () => ({
	DiscoverScreen: () => React.createElement('View', { testID: 'content' }),
}));

// モックを差し込んだうえで、テスト対象の画面を読み込む
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { HomeScreen } = require('../HomeScreen') as typeof import('../HomeScreen');

// --- ヘルパー ----------------------------------------------------------------

/**
 * accessibilityLabel から押せる要素 (onPress を持つ複合コンポーネント) を探す。
 * react-native-web のホストノードは onPress ではなく onClick を持つため、onPress を持つ側を見る。
 * IconButton → Pressable → Pressable のように同じラベルが入れ子で伝播するので、最も外側の 1 つだけを返す。
 */
const isPressableWithLabel = (node: ReactTestInstance, label: string): boolean =>
	node.props?.accessibilityLabel === label && typeof node.props?.onPress === 'function';

const findByLabel = (root: ReactTestInstance, label: string): ReactTestInstance[] =>
	root.findAll(
		node => isPressableWithLabel(node, label) && !(node.parent && isPressableWithLabel(node.parent, label)),
		{ deep: true },
	);

/** 表示中のテキストをすべて集める (葉のテキストノードの文字列)。 */
const allText = (root: ReactTestInstance): string[] =>
	root
		.findAll(node => node.children.length > 0 && node.children.every(c => typeof c === 'string'), { deep: true })
		.map(node => node.children.join(''));

/** ナビゲーションの項目の題名 (navigation.ts の RAIL_PAGES)。 */
const RAIL_TITLES = ['Division のプロジェクト管理', 'カンバン', 'エディタの UI 操作', 'ソーシャル (共有)'];

let renderer: ReactTestRenderer | null = null;

const render = async (onOpenPage: (page: PageKey) => void = jest.fn()): Promise<ReactTestRenderer> => {
	await act(async () => {
		renderer = create(React.createElement(HomeScreen, { mode: 'cloud', onModeChange: jest.fn(), onOpenPage }));
	});
	return renderer!;
};

const openDrawer = async (root: ReactTestInstance): Promise<void> => {
	const [menu] = findByLabel(root, 'メニューを開く');
	expect(menu).toBeDefined();
	await act(async () => {
		menu.props.onPress();
	});
};

afterEach(async () => {
	if (renderer) {
		await act(async () => {
			renderer!.unmount();
		});
		renderer = null;
	}
});

// --- テスト ------------------------------------------------------------------

describe('HomeScreen のナビゲーションドロワー', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('初期状態では閉じていて、項目・閉じる操作・ドロワーの地が一切残らない', async () => {
		const r = await render();
		const texts = allText(r.root);
		for (const title of RAIL_TITLES) expect(texts).not.toContain(title);
		// 閉じる操作 (ドロワー内・外側の暗い部分) も存在しない = アンマウントされている
		expect(findByLabel(r.root, 'ナビゲーションを閉じる')).toHaveLength(0);
		// 本文はメニューボタンとモード切り替えの見出しだけを持つ
		expect(findByLabel(r.root, 'メニューを開く')).toHaveLength(1);
		expect(texts).toContain('クラウドエージェント');
	});

	it('メニューボタンは本文側 (子画面の見出しの左) にある', async () => {
		const r = await render();
		const [menu] = findByLabel(r.root, 'メニューを開く');
		let cur: ReactTestInstance | null = menu.parent;
		while (cur && cur.props?.testID !== 'header-left') cur = cur.parent;
		expect(cur?.props?.testID).toBe('header-left');
	});

	it('メニューボタンで開くと既存の項目が並び、PC 接続が要るものは案内になる', async () => {
		const onOpenPage = jest.fn();
		const r = await render(onOpenPage);
		await openDrawer(r.root);

		const texts = allText(r.root);
		for (const title of RAIL_TITLES) expect(texts).toContain(title);
		expect(texts).toContain('me@example.com');

		// 未接続で開ける Division のプロジェクト管理は遷移できる
		const [projects] = findByLabel(r.root, 'Division のプロジェクト管理を開く');
		expect(projects).toBeDefined();
		// PC 接続が要るカンバンは遷移せず案内を出す (接続要否の扱いを維持)
		const [kanban] = findByLabel(r.root, 'カンバン。PC に接続すると使えます');
		expect(kanban).toBeDefined();
		await act(async () => {
			kanban.props.onPress();
		});
		expect(onOpenPage).not.toHaveBeenCalled();
		expect(mockShow).toHaveBeenCalledWith('カンバンは PC に接続すると使えます', 'info');
	});

	it('項目を選ぶとドロワーを閉じてからページ遷移する', async () => {
		const onOpenPage = jest.fn();
		const r = await render(onOpenPage);
		await openDrawer(r.root);

		const [projects] = findByLabel(r.root, 'Division のプロジェクト管理を開く');
		await act(async () => {
			projects.props.onPress();
		});

		expect(onOpenPage).toHaveBeenCalledWith('projects');
		// ドロワーは閉じている (項目も閉じる操作も残らない)
		expect(findByLabel(r.root, 'ナビゲーションを閉じる')).toHaveLength(0);
		expect(allText(r.root)).not.toContain('カンバン');
	});

	it('ドロワー内の ‹ で閉じられる', async () => {
		const r = await render();
		await openDrawer(r.root);
		const [close] = findByLabel(r.root, 'ナビゲーションを閉じる');
		expect(close).toBeDefined();

		await act(async () => {
			close.props.onPress();
		});
		expect(findByLabel(r.root, 'ナビゲーションを閉じる')).toHaveLength(0);
		expect(allText(r.root)).not.toContain('カンバン');
	});

	it('外側の暗い部分を押しても閉じられる', async () => {
		const r = await render();
		await openDrawer(r.root);
		// ‹ のボタンと外側の暗い部分の 2 つが「ナビゲーションを閉じる」
		expect(findByLabel(r.root, 'ナビゲーションを閉じる')).toHaveLength(2);
		const scrim = findByLabel(r.root, 'ナビゲーションを閉じる')[1];

		await act(async () => {
			scrim.props.onPress();
		});
		expect(findByLabel(r.root, 'ナビゲーションを閉じる')).toHaveLength(0);
	});

	it('閉じたあとでもメニューボタンから再表示できる', async () => {
		const r = await render();
		await openDrawer(r.root);
		const [close] = findByLabel(r.root, 'ナビゲーションを閉じる');
		await act(async () => {
			close.props.onPress();
		});
		expect(findByLabel(r.root, 'ナビゲーションを閉じる')).toHaveLength(0);

		await openDrawer(r.root);
		expect(findByLabel(r.root, 'ナビゲーションを閉じる')).toHaveLength(2);
		expect(allText(r.root)).toContain('カンバン');
	});
});
