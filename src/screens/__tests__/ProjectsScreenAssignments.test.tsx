/**
 * ProjectsScreen (PC 接続時) の割り当て管理の回帰テスト。
 *
 *  - 一覧に既存の割り当てが出る
 *  - 役割の追加・解除が保存 (client.saveProject) に反映される
 *  - 保存中は二重に保存されない / 失敗したらシートは開いたまま
 */

import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockClient = {
	saveProject: jest.fn(),
	getProviderModels: jest.fn(),
	activateProject: jest.fn(),
	deleteProject: jest.fn(),
	addProject: jest.fn(),
	pullProjectsFromSupabase: jest.fn(),
	pushProjectsToSupabase: jest.fn(),
};
const mockInvalidate = jest.fn();
const mockToast = jest.fn();

const mockSnapshot = {
	division: {
		projects: [
			{
				projectId: 'p1',
				name: 'Web アプリ',
				isActive: true,
				agents: [{ role: 'coder', provider: 'anthropic', model: 'claude-opus' }],
			},
		],
	},
};

jest.mock('../../state/AppContext', () => ({
	useApp: () => ({
		connection: {},
		client: mockClient,
		snapshot: mockSnapshot,
		error: null,
		isRefreshing: false,
		refresh: jest.fn(),
		invalidate: mockInvalidate,
	}),
}));

jest.mock('../../state/DivisionAuthContext', () => ({
	useDivisionAuth: () => ({ session: { userId: 'u1', email: 'a@b.c', accessToken: 't', refreshToken: 'r' } }),
}));

jest.mock('../../components/CloudProjectPicker', () => ({
	useCloudProjects: () => ({ projects: [], source: 'division', loading: false, error: null, reload: jest.fn() }),
}));

jest.mock('../../lib/divisionSocial', () => ({ publishAssignmentPost: jest.fn() }));

jest.mock('../../components/ui', () => {
	const actual = jest.requireActual('../../components/ui');
	return {
		...actual,
		useToast: () => ({ show: mockToast }),
		confirmAction: jest.fn(async () => true),
		// TextInput (react-native-web) は node 環境で document を参照するので、入力欄は軽量スタブにする
		Input: (props: { value?: string; placeholder?: string }) => React.createElement('input-stub', props),
		// Modal はテストレンダラーのツリーに出ないので、シートの中身をその場に描く
		Sheet: ({ title, headerRight, children }: { title: string; headerRight?: React.ReactNode; children: React.ReactNode }) =>
			React.createElement(React.Fragment, null, React.createElement(actual.Muted, null, title), headerRight, children),
	};
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ProjectsScreen } = require('../ProjectsScreen') as typeof import('../ProjectsScreen');

let renderer: ReactTestRenderer | null = null;

const byLabel = (root: ReactTestInstance, label: string): ReactTestInstance | undefined =>
	root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];

const press = async (root: ReactTestInstance, label: string) => {
	const node = byLabel(root, label);
	if (!node) throw new Error(`not found: ${label}`);
	await act(async () => { node.props.onPress(); });
};

const saveButtons = (root: ReactTestInstance) =>
	root.findAll(n => n.props.title === '保存' && typeof n.props.onPress === 'function');

const render = async () => {
	await act(async () => { renderer = create(React.createElement(ProjectsScreen)); });
	return renderer!.root;
};

beforeEach(() => {
	jest.clearAllMocks();
	mockClient.getProviderModels.mockResolvedValue([{ provider: 'anthropic', models: ['claude-opus'] }]);
	mockClient.saveProject.mockResolvedValue({});
});

afterEach(async () => {
	if (renderer) {
		await act(async () => { renderer!.unmount(); });
		renderer = null;
	}
});

describe('ProjectsScreen 割り当て管理 (PC 接続時)', () => {
	it('shows the existing assignments in the list', async () => {
		await render();
		const text = JSON.stringify(renderer!.toJSON());
		expect(text).toContain('Web アプリ');
		expect(text).toContain('claude-opus');
	});

	it('adds a role and persists it through saveProject', async () => {
		const root = await render();
		await press(root, 'Web アプリ を編集');
		await press(root, 'レビュー を追加');
		await act(async () => { saveButtons(root)[0].props.onPress(); });
		expect(mockClient.saveProject).toHaveBeenCalledTimes(1);
		const [id, body] = mockClient.saveProject.mock.calls[0];
		expect(id).toBe('p1');
		expect(body.agents.map((a: { role: string }) => a.role)).toEqual(['coder', 'review']);
		expect(mockInvalidate).toHaveBeenCalled();
	});

	it('removes a role and persists it', async () => {
		const root = await render();
		await press(root, 'Web アプリ を編集');
		await press(root, 'コーダー の役割を外す');
		await act(async () => { saveButtons(root)[0].props.onPress(); });
		expect(mockClient.saveProject.mock.calls[0][1].agents).toEqual([]);
	});

	it('does not save twice while a save is in flight', async () => {
		let resolve: (v: unknown) => void = () => {};
		mockClient.saveProject.mockImplementation(() => new Promise(r => { resolve = r; }));
		const root = await render();
		await press(root, 'Web アプリ を編集');
		await press(root, 'レビュー を追加');
		await act(async () => { saveButtons(root)[0].props.onPress(); });
		await act(async () => { saveButtons(root)[0].props.onPress(); });
		expect(mockClient.saveProject).toHaveBeenCalledTimes(1);
		await act(async () => { resolve({}); });
	});

	it('keeps the editor open and reports an error when saving fails', async () => {
		mockClient.saveProject.mockRejectedValue(new Error('network down'));
		const root = await render();
		await press(root, 'Web アプリ を編集');
		await press(root, 'レビュー を追加');
		await act(async () => { saveButtons(root)[0].props.onPress(); });
		expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('network down'), 'error');
		expect(JSON.stringify(renderer!.toJSON())).toContain('プロジェクトを編集');
	});
});
