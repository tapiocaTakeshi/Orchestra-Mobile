/**
 * A cloud session's .division documents (workflow, paper, specification, design): the client for
 * GET/POST /api/cloud-sessions/:id/documents… and the source the document screens use.
 * Supabase (JWT) is faked and fetch is replaced per test, like the other divisionCloud tests.
 */

jest.mock('../divisionAuth', () => ({
	getDivisionSupabase: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
	getDivisionAccessToken: jest.fn(async () => 'jwt-token'),
}));
jest.mock('../../state/AppContext', () => ({ useApp: () => ({}) }));

import { getCloudDocument, listCloudDocuments, saveCloudDocument } from '../divisionCloud';
import { cloudDocumentSource } from '../documentSource';
import { documentKindOf, documentTitle, groupDocuments } from '../divisionDocs';
import type { DivisionSession } from '../divisionAuth';

const BASE = 'https://api.division.he-ro.io/api/cloud-sessions';
const auth = { userId: 'u1' } as unknown as DivisionSession;

type Call = { url: string; init: RequestInit };
const respond = (status: number, body: unknown) => {
	const calls: Call[] = [];
	(globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		return { ok: status < 400, status, json: async () => body } as Response;
	});
	return calls;
};

describe('cloud documents', () => {
	it('lists the sandbox documents, workflow first', async () => {
		const calls = respond(200, {
			documents: [
				{ path: '.division/workflow.json', name: 'workflow.json', kind: 'workflow', size: 10, mtime: 5 },
				{ path: '.division/paper.md', name: 'paper.md', kind: 'paper', size: 3, mtime: 6 },
				{ path: '.division/odd.md', kind: 'mystery' },
				{ nope: true },
			],
			revision: 42,
		});
		const res = await listCloudDocuments(auth, 's 1');
		expect(calls[0].url).toBe(`${BASE}/s%201/documents`);
		expect(res.revision).toBe(42);
		expect(res.documents.map(d => [d.path, d.kind, d.name])).toEqual([
			['.division/workflow.json', 'workflow', 'workflow.json'],
			['.division/paper.md', 'paper', 'paper.md'],
			['.division/odd.md', 'output', 'odd.md'],
		]);
		expect(groupDocuments(res.documents).map(g => g.kind)).toEqual(['workflow', 'paper', 'output']);
	});

	it('reads and saves one document with the mtime it was opened at', async () => {
		let calls = respond(200, { path: '.division/specification.md', content: '# 仕様', size: 8, mtime: 7 });
		const doc = await getCloudDocument(auth, 's1', '.division/specification.md');
		expect(calls[0].url).toBe(`${BASE}/s1/documents/content?path=.division%2Fspecification.md`);
		expect(doc).toEqual({ path: '.division/specification.md', content: '# 仕様', size: 8, mtime: 7 });

		calls = respond(200, { path: '.division/specification.md', content: '# 仕様 v2', size: 11, mtime: 9 });
		const saved = await saveCloudDocument(auth, 's1', '.division/specification.md', '# 仕様 v2', 7);
		expect(calls[0].init.method).toBe('POST');
		expect(JSON.parse(String(calls[0].init.body))).toEqual({ path: '.division/specification.md', content: '# 仕様 v2', baseMtime: 7 });
		expect(saved.mtime).toBe(9);

		calls = respond(200, {});
		await saveCloudDocument(auth, 's1', '.division/paper.md', 'x');
		expect(JSON.parse(String(calls[0].init.body))).toEqual({ path: '.division/paper.md', content: 'x' });
	});

	it('tells a conflict (the agent wrote it since) from other errors, with the server message for document errors', async () => {
		const source = cloudDocumentSource(auth, 's1', 3);
		expect(source.where).toBe('クラウド');
		expect(source.revision).toBe(3);

		respond(409, { error: '書き換えました', code: 'document_changed' });
		const conflict = await source.save('.division/paper.md', 'x', 1).catch(e => e);
		expect(source.isConflict(conflict)).toBe(true);

		respond(400, { error: '「終了」ノードを追加してください。', code: 'invalid_workflow' });
		const invalid = await source.save('.division/workflow.json', '{}', 1).catch(e => e);
		expect(source.isConflict(invalid)).toBe(false);
		expect(source.errorText(invalid)).toBe('「終了」ノードを追加してください。');

		respond(409, { error: 'Session is running' });
		expect(source.isConflict(await source.save('.division/paper.md', 'x').catch(e => e))).toBe(false);
	});

	it('names the workflow document', () => {
		expect(documentKindOf('.division/workflow.json')).toBe('workflow');
		expect(documentTitle({ kind: 'workflow', name: 'workflow.json' })).toBe('ワークフロー');
	});
});
