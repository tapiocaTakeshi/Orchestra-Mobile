/**
 * DiscoverScreen (ホーム画面) の回帰テスト。
 *
 * 実際の DiscoverScreen コンポーネントをレンダリングし、主要な操作が正しい処理に
 * つながることを確認する。
 *  - PC 行タップ → verifyAndConnect → connect (接続)
 *  - ログアウト行タップ → 確認のうえ logout (ログアウト)
 *  - 「接続せずに使う」の各行タップ → onOpenPage (ページ遷移)
 *
 * 外部依存はモックで切り離す (実装の書き写しではなく、画面の振る舞いを検証するため):
 *  - `verifyAndConnect` / `listRemoteSessions`: ネットワークを伴うため jest モック。
 *  - `useApp` / `useDivisionAuth`: 実プロバイダは Supabase・通知・ポーリングを抱えるため、
 *    コンテキスト値を直接注入する jest モックに差し替える。
 *  - Feather アイコン / SafeAreaView: ESM 依存で ts-jest 変換できないため軽量スタブ。
 */

import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import type { RemoteSessionRow } from '../../lib/divisionAuth';
import type { PageKey } from '../../navigation';
import { colors } from '../../theme';

// react-test-renderer の act() 警告を有効化するためのフラグ
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// --- 外部依存のモック --------------------------------------------------------

const mockVerifyAndConnect = jest.fn();
const mockListRemoteSessions = jest.fn();
const mockConnect = jest.fn();
const mockLogout = jest.fn();
const mockDismissNewSession = jest.fn();

jest.mock('../../lib/connect', () => ({
	verifyAndConnect: (...args: unknown[]) => mockVerifyAndConnect(...args),
}));

jest.mock('../../lib/divisionAuth', () => ({
	listRemoteSessions: (...args: unknown[]) => mockListRemoteSessions(...args),
}));

jest.mock('../../state/AppContext', () => ({
	useApp: () => ({ connect: mockConnect }),
}));

const session = {
	userId: 'user-1',
	email: 'me@example.com',
	accessToken: 'access-token',
	refreshToken: 'refresh-token',
};

jest.mock('../../state/DivisionAuthContext', () => ({
	useDivisionAuth: () => ({
		session,
		logout: mockLogout,
		newSessionIds: [],
		dismissNewSession: mockDismissNewSession,
	}),
}));

// モックを差し込んだうえで、テスト対象の画面を読み込む
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DiscoverScreen } = require('../DiscoverScreen') as typeof import('../DiscoverScreen');

// --- ヘルパー ----------------------------------------------------------------

const pcRow: RemoteSessionRow = {
	id: 'pc-1',
	deviceLabel: '作業用 PC',
	lanUrl: 'http://192.168.0.10:8080',
	token: 'pairing-token',
	protocolVersion: 1,
	lastSeenAt: new Date().toISOString(),
};

/** 葉のテキストノード (子が全部文字列) を探す。 */
const findTextNode = (root: ReactTestInstance, text: string): ReactTestInstance | undefined =>
	root
		.findAll(
			(node) =>
				node.children.length > 0 &&
				node.children.every((c) => typeof c === 'string') &&
				node.children.join('') === text,
			{ deep: true },
		)[0];

/**
 * 題名テキストから祖先を辿って、押せる行 (onPress を持つノード) を見つける。
 * react-native-web の Pressable はラベルを複数の子孫に伝播させるため、
 * accessibilityLabel より「表示テキスト → 祖先のボタン」の方が一意に安定して特定できる。
 */
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

/** 表示中のテキストをすべて集める (葉のテキストノードの文字列)。 */
const allText = (root: ReactTestInstance): string[] =>
	root
		.findAll(
			(node) => node.children.length > 0 && node.children.every((c) => typeof c === 'string'),
			{ deep: true },
		)
		.map((node) => node.children.join(''));

let renderer: ReactTestRenderer | null = null;

const render = async (onOpenPage: (page: PageKey) => void): Promise<ReactTestRenderer> => {
	await act(async () => {
		renderer = create(React.createElement(DiscoverScreen, { onOpenPage }));
	});
	return renderer!;
};

afterEach(async () => {
	// アンマウントして DiscoverScreen のポーリング setInterval を止め、jest のハングを防ぐ。
	if (renderer) {
		await act(async () => {
			renderer!.unmount();
		});
		renderer = null;
	}
});

// --- テスト ------------------------------------------------------------------

describe('DiscoverScreen (ホーム画面)', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockListRemoteSessions.mockResolvedValue([pcRow]);
		mockVerifyAndConnect.mockResolvedValue({ ok: true, connection: { url: pcRow.lanUrl, token: pcRow.token, label: pcRow.deviceLabel } });
		mockConnect.mockResolvedValue(undefined);
		mockLogout.mockResolvedValue(undefined);
	});

	it('情報が見出しごとに整理されて表示される', async () => {
		const r = await render(jest.fn());
		const texts = allText(r.root);
		expect(texts).toContain('PC に接続');
		expect(texts).toContain('接続せずに使う');
		expect(texts).toContain('アカウント');
		expect(texts).toContain('作業用 PC');
		expect(texts).toContain('ログアウト');
	});

	it('PC 行をタップすると verifyAndConnect 経由で connect が呼ばれる (接続)', async () => {
		const r = await render(jest.fn());
		const row = findRowByTitle(r.root, '作業用 PC');

		await act(async () => {
			row.props.onPress();
		});

		expect(mockVerifyAndConnect).toHaveBeenCalledTimes(1);
		const [candidate, connectFn, account] = mockVerifyAndConnect.mock.calls[0];
		expect(candidate).toEqual({ url: pcRow.lanUrl, token: pcRow.token, label: pcRow.deviceLabel });
		expect(connectFn).toBe(mockConnect);
		expect(account.accessToken).toBe(session.accessToken);
	});

	it('接続に成功すると NEW バッジの解除 (dismissNewSession) が呼ばれる', async () => {
		const r = await render(jest.fn());
		const row = findRowByTitle(r.root, '作業用 PC');
		await act(async () => {
			row.props.onPress();
		});
		expect(mockDismissNewSession).toHaveBeenCalledWith(pcRow.id);
	});

	it('接続に失敗しても connect は呼ばれず、クラッシュしない', async () => {
		mockVerifyAndConnect.mockResolvedValue({ ok: false, message: 'トークンが一致しません。' });
		const r = await render(jest.fn());
		const row = findRowByTitle(r.root, '作業用 PC');
		await act(async () => {
			row.props.onPress();
		});
		expect(mockConnect).not.toHaveBeenCalled();
		expect(mockDismissNewSession).not.toHaveBeenCalled();
	});

	it('ログアウト行をタップすると logout が呼ばれる (ログアウト)', async () => {
		const r = await render(jest.fn());
		const row = findRowByTitle(r.root, 'ログアウト');

		await act(async () => {
			row.props.onPress();
		});

		expect(mockLogout).toHaveBeenCalledTimes(1);
	});

	it('「接続せずに使う」の各行が対応するページ遷移 (onOpenPage) を呼ぶ', async () => {
		const onOpenPage = jest.fn();
		const r = await render(onOpenPage);

		// 未接続で開けるのは cloud / social / tuning (navigation.ts の PAGES)
		const cases: { label: string; key: PageKey }[] = [
			{ label: 'クラウド', key: 'cloud' },
			{ label: '共有', key: 'social' },
			{ label: 'コスト', key: 'tuning' },
		];
		for (const { label, key } of cases) {
			const row = findRowByTitle(r.root, label);
			await act(async () => {
				row.props.onPress();
			});
			expect(onOpenPage).toHaveBeenCalledWith(key);
		}
		expect(onOpenPage).toHaveBeenCalledTimes(cases.length);
	});

	it('ログアウトの確認でキャンセルすると logout は呼ばれない', async () => {
		// react-native-web では confirmAction が globalThis.confirm を使う
		const g = globalThis as { confirm?: (text: string) => boolean };
		const original = g.confirm;
		g.confirm = jest.fn(() => false);
		try {
			const r = await render(jest.fn());
			const row = findRowByTitle(r.root, 'ログアウト');
			await act(async () => {
				row.props.onPress();
			});
			expect(g.confirm).toHaveBeenCalledTimes(1);
			expect(mockLogout).not.toHaveBeenCalled();
		} finally {
			g.confirm = original;
		}
	});

	it('アイコン色: 主役の PC 行はアクセント色、ログアウトは danger、その他は通常色', async () => {
		const r = await render(jest.fn());
		const iconColor = (name: string): unknown =>
			r.root.findAll((node) => node.props.testID === `icon-${name}`)[0]?.props.style?.color;

		expect(iconColor('monitor')).toBe(colors.accentText);
		expect(iconColor('log-out')).toBe(colors.danger);
		// 未接続で開けるページ (primary ではない) は通常のミュート色のまま
		expect(iconColor('cloud')).toBe(colors.fgMuted);
	});
});
