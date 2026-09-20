import { AssignmentPost, PostAssignment } from '../social';
import {
	assignmentSummary,
	filterPosts,
	matchesQuery,
	mergeAssignments,
	parseAssignments,
	sortPosts,
	toPostAssignments,
	toRoleAssignments,
	usedProviders,
} from '../social';

const assignment = (overrides: Partial<PostAssignment> & { roleSlug: string }): PostAssignment => ({
	roleName: overrides.roleSlug,
	providerName: 'openAI',
	providerDisplayName: 'OpenAI',
	model: 'gpt-5.4',
	modelDisplayName: 'gpt-5.4',
	priority: 0,
	...overrides,
});

const post = (overrides: Partial<AssignmentPost> & { id: string }): AssignmentPost => ({
	authorId: 'u1',
	authorName: '作者',
	title: 'タイトル',
	description: '',
	assignments: [],
	sourceProjectId: null,
	likeCount: 0,
	importCount: 0,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	likedByMe: false,
	mine: false,
	...overrides,
});

describe('parseAssignments', () => {
	it('Supabase の形をそのまま読める', () => {
		const parsed = parseAssignments([
			{ roleSlug: 'leader', roleName: 'Leader', providerName: 'OpenAI', providerDisplayName: 'OpenAI', model: 'gpt-5.4-mini', modelDisplayName: 'gpt-5.4-mini', priority: 0 },
		]);
		expect(parsed).toHaveLength(1);
		expect(parsed[0].model).toBe('gpt-5.4-mini');
	});

	it('IDE 側の綴り (role / provider) でも読める', () => {
		const parsed = parseAssignments([{ role: 'coder', provider: 'anthropic', model: 'claude-opus-4-7' }]);
		expect(parsed[0]).toMatchObject({ roleSlug: 'coder', providerName: 'anthropic', model: 'claude-opus-4-7' });
		// 表示名が無ければ補完される
		expect(parsed[0].roleName).toBe('コーダー');
		expect(parsed[0].modelDisplayName).toBe('claude-opus-4-7');
		expect(parsed[0].priority).toBe(0);
	});

	it('配列でないもの・役割の無い行は落とす', () => {
		expect(parseAssignments(null)).toEqual([]);
		expect(parseAssignments([{ model: 'x' }, null])).toEqual([]);
	});
});

describe('toRoleAssignments', () => {
	it('priority 順に並べ直す', () => {
		const roles = toRoleAssignments([
			assignment({ roleSlug: 'review', priority: 2 }),
			assignment({ roleSlug: 'leader', priority: 0 }),
			assignment({ roleSlug: 'coder', priority: 1 }),
		]);
		expect(roles.map(r => r.role)).toEqual(['leader', 'coder', 'review']);
	});

	it('往復しても役割とモデルが保たれる', () => {
		const original = [{ role: 'leader', provider: 'openAI', model: 'gpt-5.4' }];
		expect(toRoleAssignments(toPostAssignments(original))).toEqual(original);
	});
});

describe('mergeAssignments', () => {
	const current = [
		{ role: 'leader', provider: 'openAI', model: 'gpt-5.4' },
		{ role: 'coder', provider: 'openAI', model: 'gpt-5.4' },
	];

	it('同じ役割は上書きし、無い役割は足す', () => {
		const merged = mergeAssignments(current, [
			{ role: 'coder', provider: 'anthropic', model: 'claude-opus-4-7' },
			{ role: 'review', provider: 'openAI', model: 'gpt-5.4-mini' },
		]);
		expect(merged).toEqual([
			{ role: 'leader', provider: 'openAI', model: 'gpt-5.4' },
			{ role: 'coder', provider: 'anthropic', model: 'claude-opus-4-7' },
			{ role: 'review', provider: 'openAI', model: 'gpt-5.4-mini' },
		]);
	});

	it('取り込むものが無ければ元のまま', () => {
		expect(mergeAssignments(current, [])).toEqual(current);
	});
});

describe('検索と並べ替え', () => {
	const posts = [
		post({ id: 'a', title: '安い構成', likeCount: 1, importCount: 9, createdAt: '2026-01-01T00:00:00.000Z' }),
		post({ id: 'b', title: '速い構成', likeCount: 5, importCount: 0, createdAt: '2026-02-01T00:00:00.000Z' }),
		post({ id: 'c', title: 'レビュー重視', likeCount: 5, importCount: 2, createdAt: '2026-03-01T00:00:00.000Z', assignments: [assignment({ roleSlug: 'review', model: 'claude-sonnet-4-6' })] }),
	];

	it('タイトル・モデル名で引ける', () => {
		expect(matchesQuery(posts[0], '安い')).toBe(true);
		expect(matchesQuery(posts[0], 'claude')).toBe(false);
		expect(matchesQuery(posts[2], 'claude')).toBe(true);
		expect(matchesQuery(posts[0], '  ')).toBe(true);
	});

	it('新着・人気・取り込み数で並べ替えられる', () => {
		expect(sortPosts(posts, 'new').map(p => p.id)).toEqual(['c', 'b', 'a']);
		// いいね数が同じときは新しい方が先
		expect(sortPosts(posts, 'popular').map(p => p.id)).toEqual(['c', 'b', 'a']);
		expect(sortPosts(posts, 'imported').map(p => p.id)).toEqual(['a', 'c', 'b']);
	});

	it('絞り込みと並べ替えを同時にかけられる', () => {
		expect(filterPosts(posts, '構成', 'popular').map(p => p.id)).toEqual(['b', 'a']);
	});
});

describe('表示用の要約', () => {
	const assignments = [
		assignment({ roleSlug: 'leader', roleName: 'リーダー', modelDisplayName: 'gpt-5.4-mini', priority: 0 }),
		assignment({ roleSlug: 'coder', roleName: 'コーダー', modelDisplayName: 'Claude Opus 4.7', providerDisplayName: 'Anthropic', priority: 1 }),
		assignment({ roleSlug: 'review', roleName: 'レビュー', modelDisplayName: 'gpt-5.4', priority: 2 }),
		assignment({ roleSlug: 'search', roleName: '検索', modelDisplayName: 'Sonar Pro', providerDisplayName: 'Perplexity', priority: 3 }),
	];

	it('先頭だけ出して残りは件数にする', () => {
		expect(assignmentSummary(assignments)).toBe('リーダー: gpt-5.4-mini · コーダー: Claude Opus 4.7 · レビュー: gpt-5.4 ほか 1 件');
	});

	it('プロバイダーは重複を除いて priority 順', () => {
		expect(usedProviders(assignments)).toEqual(['OpenAI', 'Anthropic', 'Perplexity']);
	});
});
