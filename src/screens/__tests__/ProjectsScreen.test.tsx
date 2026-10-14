/**
 * ProjectsScreen (Division プロジェクト管理) の回帰テスト。
 *
 * PC に接続していなくても、Division API (Web のディビジョンプロジェクトと同じ一覧) を
 * 読んでプロジェクトを表示できることを確認する。
 *
 * 外部依存はモックで切り離す:
 *  - `useApp` … 未接続 (client / snapshot が null) を注入。
 *  - `useDivisionAuth` … ログイン済みセッションを注入。
 *  - `useCloudProjects` … Division API の一覧を返すスタブ (ネットワークを伴わない)。
 *  - Feather アイコン / SafeAreaView: ESM 依存で ts-jest 変換できないため軽量スタブ (jest の moduleNameMapper)。
 */

import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// --- 外部依存のモック --------------------------------------------------------

jest.mock('../../state/AppContext', () => ({
	useApp: () => ({
		connection: null,
		client: null,
		snapshot: null,
		error: null,
		isRefreshing: false,
		refresh: jest.fn(),
		invalidate: jest.fn(),
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

const mockReload = jest.fn();
jest.mock('../../components/CloudProjectPicker', () => ({
	useCloudProjects: () => ({
		projects: [
			{ id: 'proj-1', name: 'Web アプリ', active: true },
			{ id: 'proj-2', name: '社内ツール' },
		],
		source: 'division',
		loading: false,
		error: null,
		reload: mockReload,
	}),
}));

// ソーシャル公開など、未接続では使わない経路は空実装にしておく
jest.mock('../../lib/divisionSocial', () => ({
	publishAssignmentPost: jest.fn(),
}));

// useToast は ToastProvider を抱えるので、ui モジュールだけ差し替える
jest.mock('../../components/ui', () => {
	const actual = jest.requireActual('../../components/ui');
	return {
		...actual,
		useToast: () => ({ show: jest.fn() }),
		confirmAction: jest.fn(async () => true),
	};
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ProjectsScreen } = require('../ProjectsScreen') as typeof import('../ProjectsScreen');

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

let renderer: ReactTestRenderer | null = null;

const render = async (): Promise<ReactTestRenderer> => {
	await act(async () => {
		renderer = create(React.createElement(ProjectsScreen));
	});
	return renderer!;
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

describe('ProjectsScreen (PC 未接続)', () => {
	it('shows projects from the Division API without a PC connection', async () => {
		const tree = await render();
		expect(findTextNode(tree.root, 'クラウドのプロジェクト')).toBeTruthy();
		expect(findTextNode(tree.root, 'Web アプリ')).toBeTruthy();
		expect(findTextNode(tree.root, '社内ツール')).toBeTruthy();
	});

	it('does not ask for a PC connection or show the loading state forever', async () => {
		const tree = await render();
		expect(findTextNode(tree.root, 'プロジェクトを読み込んでいます…')).toBeUndefined();
	});
});
