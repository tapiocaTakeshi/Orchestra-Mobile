/**
 * ソーシャルの取り込みが PC 無しでも使えることの回帰テスト。
 *
 * PC に繋いでいないときは、Division API のプロジェクト (useServerProjects) に取り込む:
 *  - 既存に重ねる → save に、既存の役割を残しつつ投稿の割り当てを重ねた一覧が渡る
 *  - 新しいプロジェクト → create に投稿の割り当てが渡る
 */

import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockSave = jest.fn(async () => ({}));
const mockCreate = jest.fn(async () => ({}));
const mockToast = jest.fn();

const POST = {
	id: 'post-1',
	authorId: 'someone',
	authorName: 'someone',
	title: '安い構成',
	description: '',
	assignments: [
		{ roleSlug: 'coder', roleName: 'コーダー', providerName: 'openai', providerDisplayName: 'OpenAI', model: 'gpt-6-luna', modelDisplayName: 'gpt-6-luna', priority: 0 },
	],
	sourceProjectId: null,
	likeCount: 0,
	importCount: 0,
	createdAt: '2026-11-01T00:00:00.000Z',
	updatedAt: '2026-11-01T00:00:00.000Z',
	likedByMe: false,
	mine: false,
};

jest.mock('react-native', () => {
	const actual = jest.requireActual('react-native');
	const ReactActual = jest.requireActual('react');
	return { ...actual, TextInput: (props: object) => ReactActual.createElement('input-stub', props) };
});

jest.mock('../../state/AppContext', () => ({
	useApp: () => ({ connection: null, client: null, snapshot: null, invalidate: jest.fn() }),
}));

// 本物と同じく、描画ごとに同じセッションを返す (別物にすると投稿の読み込みが繰り返される)
const mockAuth = { session: { userId: 'u1', email: 'a@b.c', accessToken: 't', refreshToken: 'r' } };
jest.mock('../../state/DivisionAuthContext', () => ({
	useDivisionAuth: () => mockAuth,
}));

jest.mock('../../state/useServerProjects', () => ({
	useServerProjects: () => ({
		projects: [{ projectId: 'proj-1', name: 'Web アプリ', isActive: false, agents: [
			{ role: 'leader', provider: 'anthropic', model: 'claude-fable-5-2' },
			{ role: 'coder', provider: 'anthropic', model: 'claude-opus-5-5' },
		] }],
		providers: [],
		loading: false,
		error: null,
		reload: jest.fn(),
		save: mockSave,
		create: mockCreate,
		remove: jest.fn(),
	}),
}));

jest.mock('../../lib/divisionSocial', () => ({
	listAssignmentPosts: jest.fn(async () => [POST]),
	importAssignmentPost: jest.fn(async () => POST.assignments),
	publishAssignmentPost: jest.fn(),
	updateAssignmentPost: jest.fn(),
	deleteAssignmentPost: jest.fn(),
	setPostLike: jest.fn(),
	reportPost: jest.fn(),
	blockUser: jest.fn(),
	listBlockedUsers: jest.fn(async () => []),
	unblockUser: jest.fn(),
	ModerationError: class extends Error {},
}));

jest.mock('../../components/ui', () => {
	const actual = jest.requireActual('../../components/ui');
	return {
		...actual,
		useToast: () => ({ show: mockToast }),
		confirmAction: jest.fn(async () => true),
		Input: (props: object) => React.createElement('input-stub', props),
		Sheet: ({ title, children }: { title: string; children: React.ReactNode }) =>
			React.createElement(React.Fragment, null, React.createElement(actual.Muted, null, title), children),
	};
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SocialScreen } = require('../SocialScreen') as typeof import('../SocialScreen');

let renderer: ReactTestRenderer | null = null;

const render = async () => {
	await act(async () => { renderer = create(React.createElement(SocialScreen)); });
	return renderer!.root;
};

const importButtons = (root: ReactTestInstance) =>
	root.findAll(n => n.props.title === '取り込む' && typeof n.props.onPress === 'function');

const pressText = async (root: ReactTestInstance, text: string) => {
	const node = root.findAll(n => typeof n.props.onPress === 'function' && n.findAll(c => c.children.includes(text)).length > 0).pop();
	if (!node) throw new Error(`not found: ${text}`);
	await act(async () => { node.props.onPress(); });
};

afterEach(async () => {
	if (renderer) {
		await act(async () => { renderer!.unmount(); });
		renderer = null;
	}
	jest.clearAllMocks();
});

describe('SocialScreen 取り込み (PC 未接続)', () => {
	it('lets the user import without a PC and merges into a cloud project', async () => {
		const root = await render();
		const onCard = importButtons(root);
		expect(onCard).toHaveLength(1);
		expect(onCard[0].props.disabled).toBeFalsy();
		await act(async () => { onCard[0].props.onPress(); });

		// シートの「取り込む」(カードのものの後ろ)
		const buttons = importButtons(root);
		await act(async () => { buttons[buttons.length - 1].props.onPress(); });

		expect(mockSave).toHaveBeenCalledWith('proj-1', { agents: [
			{ role: 'leader', provider: 'anthropic', model: 'claude-fable-5-2' },
			{ role: 'coder', provider: 'openai', model: 'gpt-6-luna' },
		] });
		expect(mockToast).toHaveBeenCalledWith('「Web アプリ」に取り込みました。', 'success');
	});

	it('can import as a new cloud project', async () => {
		const root = await render();
		await act(async () => { importButtons(root)[0].props.onPress(); });
		await pressText(root, '新しいプロジェクト');
		const buttons = importButtons(root);
		await act(async () => { buttons[buttons.length - 1].props.onPress(); });
		expect(mockCreate).toHaveBeenCalledWith({
			name: '安い構成',
			agents: [{ role: 'coder', provider: 'openai', model: 'gpt-6-luna' }],
		});
	});
});
