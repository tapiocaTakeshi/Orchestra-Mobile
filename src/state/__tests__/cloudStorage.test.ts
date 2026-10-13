const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
	__esModule: true,
	default: {
		getItem: jest.fn(async (k: string) => (mockStore.has(k) ? mockStore.get(k)! : null)),
		setItem: jest.fn(async (k: string, v: string) => { mockStore.set(k, v); }),
		removeItem: jest.fn(async (k: string) => { mockStore.delete(k); }),
		multiRemove: jest.fn(async (keys: string[]) => { keys.forEach(k => mockStore.delete(k)); }),
	},
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
	MAX_SAVED_CLOUD_REPOS,
	clearLastCloudRepo,
	loadCloudRepos,
	loadLastCloudRepo,
	removeCloudRepo,
	saveCloudRepo,
	saveLastCloudRepo,
} from '../cloudStorage';
import { GitHubRepo } from '../../lib/divisionGitHub';

const LEGACY_KEY = 'orchestra.cloudLastRepo.v1';
const NEW_KEY = 'orchestra.cloudRepos.v2';

const repo = (fullName: string, over: Partial<GitHubRepo> = {}): GitHubRepo => {
	const [owner, name] = fullName.split('/');
	return { fullName, name, owner, private: false, defaultBranch: 'main', ...over } as GitHubRepo;
};

beforeEach(() => {
	mockStore.clear();
	jest.clearAllMocks();
});

describe('cloud repo list', () => {
	it('starts empty', async () => {
		expect(await loadCloudRepos('u1')).toEqual([]);
		expect(await loadLastCloudRepo('u1')).toBeNull();
	});

	it('adds repos, most recently used first, and survives a reload', async () => {
		await saveCloudRepo('u1', { repo: repo('o/a'), branch: '' });
		await saveCloudRepo('u1', { repo: repo('o/b'), branch: 'dev' });
		const list = await loadCloudRepos('u1');
		expect(list.map(e => e.repo.fullName)).toEqual(['o/b', 'o/a']);
		expect(list[0].branch).toBe('dev');
		expect((await loadLastCloudRepo('u1'))?.repo.fullName).toBe('o/b');
	});

	it('edits an existing repo (branch) without duplicating it, case-insensitively, and moves it to the front', async () => {
		await saveCloudRepo('u1', { repo: repo('o/a'), branch: 'main' });
		await saveCloudRepo('u1', { repo: repo('o/b'), branch: '' });
		await saveCloudRepo('u1', { repo: repo('O/A'), branch: 'feature' });
		const list = await loadCloudRepos('u1');
		expect(list).toHaveLength(2);
		expect(list[0]).toMatchObject({ branch: 'feature' });
		expect(list[0].repo.fullName).toBe('O/A');
		expect(list[1].repo.fullName).toBe('o/b');
	});

	it('removes a repo and keeps the rest; removing an unknown one is a no-op', async () => {
		await saveCloudRepo('u1', { repo: repo('o/a'), branch: '' });
		await saveCloudRepo('u1', { repo: repo('o/b'), branch: '' });
		await removeCloudRepo('u1', 'O/A');
		expect((await loadCloudRepos('u1')).map(e => e.repo.fullName)).toEqual(['o/b']);
		await removeCloudRepo('u1', 'x/none');
		expect((await loadCloudRepos('u1')).map(e => e.repo.fullName)).toEqual(['o/b']);
	});

	it('caps the list and drops the oldest', async () => {
		for (let i = 0; i < MAX_SAVED_CLOUD_REPOS + 3; i++) {
			await saveCloudRepo('u1', { repo: repo(`o/r${i}`), branch: '' });
		}
		const list = await loadCloudRepos('u1');
		expect(list).toHaveLength(MAX_SAVED_CLOUD_REPOS);
		expect(list[0].repo.fullName).toBe(`o/r${MAX_SAVED_CLOUD_REPOS + 2}`);
		expect(list.some(e => e.repo.fullName === 'o/r0')).toBe(false);
	});

	it('does not leak repos to another user', async () => {
		await saveCloudRepo('u1', { repo: repo('o/a'), branch: '' });
		expect(await loadCloudRepos('u2')).toEqual([]);
	});

	it('skips broken entries and duplicates, and tolerates corrupt JSON', async () => {
		mockStore.set(NEW_KEY, JSON.stringify({
			userId: 'u1',
			repos: [{ repo: repo('o/a'), branch: 'x' }, { repo: { fullName: 'broken' } }, null, { repo: repo('O/A'), branch: 'dup' }, { repo: repo('o/b') }],
		}));
		const list = await loadCloudRepos('u1');
		expect(list.map(e => e.repo.fullName)).toEqual(['o/a', 'o/b']);
		expect(list[1].branch).toBe('');

		mockStore.set(NEW_KEY, '{not json');
		expect(await loadCloudRepos('u1')).toEqual([]);
	});
});

describe('migration from the single-repo setting', () => {
	it('picks up the legacy repo when there is no list yet', async () => {
		mockStore.set(LEGACY_KEY, JSON.stringify({ userId: 'u1', repo: repo('o/old'), branch: 'legacy' }));
		const list = await loadCloudRepos('u1');
		expect(list).toEqual([{ repo: repo('o/old'), branch: 'legacy' }]);
		expect((await loadLastCloudRepo('u1'))?.branch).toBe('legacy');
	});

	it('ignores a legacy repo that belongs to another user', async () => {
		mockStore.set(LEGACY_KEY, JSON.stringify({ userId: 'other', repo: repo('o/old'), branch: '' }));
		expect(await loadCloudRepos('u1')).toEqual([]);
	});

	it('keeps the legacy repo in the list when a new one is added, then drops the legacy key', async () => {
		mockStore.set(LEGACY_KEY, JSON.stringify({ userId: 'u1', repo: repo('o/old'), branch: '' }));
		await saveLastCloudRepo('u1', { repo: repo('o/new'), branch: '' });
		expect((await loadCloudRepos('u1')).map(e => e.repo.fullName)).toEqual(['o/new', 'o/old']);
		expect(mockStore.has(LEGACY_KEY)).toBe(false);
		expect(mockStore.has(NEW_KEY)).toBe(true);
	});

	it('does not resurrect the legacy repo after the last entry is removed', async () => {
		mockStore.set(LEGACY_KEY, JSON.stringify({ userId: 'u1', repo: repo('o/old'), branch: '' }));
		await removeCloudRepo('u1', 'o/old');
		expect(await loadCloudRepos('u1')).toEqual([]);
	});

	it('prefers the new list over a stale legacy key', async () => {
		mockStore.set(LEGACY_KEY, JSON.stringify({ userId: 'u1', repo: repo('o/old'), branch: '' }));
		mockStore.set(NEW_KEY, JSON.stringify({ userId: 'u1', repos: [{ repo: repo('o/new'), branch: '' }] }));
		expect((await loadCloudRepos('u1')).map(e => e.repo.fullName)).toEqual(['o/new']);
	});
});

describe('clearLastCloudRepo', () => {
	it('removes both the list and the legacy key', async () => {
		mockStore.set(LEGACY_KEY, 'x');
		await saveCloudRepo('u1', { repo: repo('o/a'), branch: '' });
		mockStore.set(LEGACY_KEY, 'x');
		await clearLastCloudRepo();
		expect(await loadCloudRepos('u1')).toEqual([]);
		expect(mockStore.size).toBe(0);
	});

	it('never throws when storage fails', async () => {
		(AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
		await expect(saveCloudRepo('u1', { repo: repo('o/a'), branch: '' })).resolves.toBeUndefined();
		(AsyncStorage.multiRemove as jest.Mock).mockRejectedValueOnce(new Error('x'));
		await expect(clearLastCloudRepo()).resolves.toBeUndefined();
	});
});
