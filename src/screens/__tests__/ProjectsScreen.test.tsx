/**
 * ProjectsScreen (Division プロジェクト管理) の回帰テスト。
 *
 * PC に接続していなくても、Division API (Web のディビジョンプロジェクトと同じ一覧) を
 * 読んでプロジェクトを表示し、その場で編集して保存できることを確認する。
 *
 * 外部依存はモックで切り離す:
 *  - `useApp` … 未接続 (client / snapshot が null) を注入。
 *  - `useDivisionAuth` … ログイン済みセッションを注入。
 *  - `useServerProjects` … Division API の一覧と保存を返すスタブ (ネットワークを伴わない)。
 *  - Feather アイコン / SafeAreaView: ESM 依存で ts-jest 変換できないため軽量スタブ (jest の moduleNameMapper)。
 */

import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// --- 外部依存のモック --------------------------------------------------------

// TextInput (react-native-web) は node 環境で document を参照するので、検索欄は軽量スタブにする
jest.mock('react-native', () => {
	const actual = jest.requireActual('react-native');
	const ReactActual = jest.requireActual('react');
	return { ...actual, TextInput: (props: object) => ReactActual.createElement('input-stub', props) };
});

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
const mockSave = jest.fn(async () => ({}));
jest.mock('../../state/useServerProjects', () => ({
	useServerProjects: () => ({
		projects: [
			{ projectId: 'proj-1', name: 'Web アプリ', isActive: false, agents: [{ role: 'coder', provider: 'anthropic', model: 'claude-opus-5-5' }] },
			{ projectId: 'proj-2', name: '社内ツール', isActive: false, agents: [] },
		],
		providers: [{ provider: 'anthropic', models: ['claude-opus-5-5', 'claude-sonnet-5-5'] }],
		loading: false,
		error: null,
		reload: mockReload,
		save: mockSave,
		create: jest.fn(),
		remove: jest.fn(),
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
		// Modal はテストレンダラーのツリーに出ないので、シートの中身をその場に描く
		Sheet: ({ title, headerRight, children }: { title: string; headerRight?: React.ReactNode; children: React.ReactNode }) =>
			React.createElement(React.Fragment, null, React.createElement(actual.Muted, null, title), headerRight, children),
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

	it('edits a project\'s role → model lines and saves them to the Division API', async () => {
		const tree = await render();
		const edit = tree.root.findAll(n => n.props.accessibilityLabel === 'Web アプリ を編集' && typeof n.props.onPress === 'function')[0];
		await act(async () => { edit.props.onPress(); });
		// コーダーのモデルを Sonnet に変える
		const open = tree.root.findAll(n => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.endsWith('モデルを変更') && typeof n.props.onPress === 'function')[0];
		await act(async () => { open.props.onPress(); });
		const chip = tree.root.findAll(n => typeof n.props.onPress === 'function' && n.findAll(c => c.children.includes('claude-sonnet-5-5')).length > 0)[0];
		await act(async () => { chip.props.onPress(); });
		const save = tree.root.findAll(n => n.props.title === '保存' && typeof n.props.onPress === 'function')[0];
		await act(async () => { save.props.onPress(); });
		expect(mockSave).toHaveBeenCalledWith('proj-1', {
			name: 'Web アプリ',
			agents: [{ role: 'coder', provider: 'anthropic', model: 'claude-sonnet-5-5' }],
		});
	});

	it('does not ask for a PC connection or show the loading state forever', async () => {
		const tree = await render();
		expect(findTextNode(tree.root, 'プロジェクトを読み込んでいます…')).toBeUndefined();
	});
});
