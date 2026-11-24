import type { RemoteDocument, ReviewOutputs } from '../../api/types';
import { splitDesignPages } from '../designPages';
import {
	documentFormat, documentKindOf, documentTitle, editedOutputsOf, groupDocuments, inlineStylesheets, isEdited, localStylesheets, normalizeDocumentKind, resolveRelative, withViewport,
} from '../divisionDocs';

describe('divisionDocs', () => {
	it('tells the market research, the specification, the design and other outputs apart', () => {
		expect(documentKindOf('market-research.md')).toBe('market-research');
		expect(documentKindOf('.division/market-research.md')).toBe('market-research');
		// 旧名の paper.md もマーケットリサーチ
		expect(documentKindOf('paper.md')).toBe('market-research');
		expect(documentKindOf('.division/paper.md')).toBe('market-research');
		expect(documentKindOf('.division/specification.md')).toBe('specification');
		expect(documentKindOf('design/index.html')).toBe('design');
		expect(documentKindOf('DESIGN.html')).toBe('design');
		expect(documentKindOf('REVIEW.md')).toBe('output');
		expect(documentTitle({ kind: 'market-research', name: 'market-research.md' })).toBe('マーケットリサーチ');
		expect(documentTitle({ kind: 'design', name: 'design/login.html' })).toBe('login.html');
		// 複数リポジトリのセッション: 各リポジトリの .division の文書はリポジトリ名つき
		expect(documentTitle({ kind: 'output', name: 'CODER.md', path: 'Orchestra-Mobile/.division/CODER.md' })).toBe('Orchestra-Mobile · CODER.md');
		expect(documentTitle({ kind: 'market-research', name: 'market-research.md', path: 'Division/.division/market-research.md' })).toBe('Division · マーケットリサーチ');
		expect(documentTitle({ kind: 'market-research', name: 'market-research.md', path: '.division/market-research.md' })).toBe('マーケットリサーチ');
	});

	it('reads the legacy "paper" kind (and a market-research.md an old server calls an output) as market research', () => {
		expect(normalizeDocumentKind('paper', 'paper.md')).toBe('market-research');
		expect(normalizeDocumentKind('paper')).toBe('market-research');
		expect(normalizeDocumentKind('market-research', 'market-research.md')).toBe('market-research');
		expect(normalizeDocumentKind('output', 'market-research.md')).toBe('market-research');
		expect(normalizeDocumentKind('output', 'paper.md')).toBe('market-research');
		expect(normalizeDocumentKind('output', 'REVIEW.md')).toBe('output');
		expect(normalizeDocumentKind('specification', 'specification.md')).toBe('specification');
		expect(normalizeDocumentKind('mystery', 'odd.md')).toBe('output');
		expect(normalizeDocumentKind(undefined, 'workflow.json')).toBe('output');
	});

	it('groups documents in the order market research → specification → design → outputs', () => {
		const doc = (name: string, kind: RemoteDocument['kind']): RemoteDocument => ({ path: `.division/${name}`, name, kind, size: 1, mtime: 1 });
		const groups = groupDocuments([doc('REVIEW.md', 'output'), doc('design/index.html', 'design'), doc('specification.md', 'specification'), doc('market-research.md', 'market-research')]);
		expect(groups.map(g => g.kind)).toEqual(['market-research', 'specification', 'design', 'output']);
	});

	it('inlines the local stylesheets a design page reads, and leaves remote ones', () => {
		const html = '<head><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="https://fonts.example/x.css"></head><body></body>';
		expect(localStylesheets(html)).toEqual(['tokens.css']);
		expect(resolveRelative('.division/design/index.html', 'tokens.css')).toBe('.division/design/tokens.css');
		expect(resolveRelative('.division/design/index.html', '../shared/a.css')).toBe('.division/shared/a.css');
		const out = inlineStylesheets(html, { 'tokens.css': ':root{--c:red}' });
		expect(out).toContain('<style data-href="tokens.css">');
		expect(out).toContain(':root{--c:red}');
		expect(out).toContain('https://fonts.example/x.css');
		expect(withViewport(out)).toMatch(/<head>\s*<meta name="viewport"/);
	});

	it('draws html pages, the designer output as pages, and markdown otherwise', () => {
		expect(documentFormat('.division/design/index.html', '<!DOCTYPE html><html></html>')).toBe('html');
		expect(documentFormat('design/index.html', '```html index.html\n<!DOCTYPE html><html><body>a</body></html>\n```\n```html login.html\n<html><body>b</body></html>\n```')).toBe('pages');
		expect(documentFormat('market-research.md', '# マーケットリサーチ')).toBe('markdown');
		expect(splitDesignPages('```html index.html\n<html><body>a</body></html>\n```\n```html login.html\n<html><body>b</body></html>\n```').map(p => p.name)).toEqual(['index.html', 'login.html']);
	});

	it('sends edited outputs only when something was edited, with the others unchanged', () => {
		const review: ReviewOutputs = {
			flowRole: 'writer',
			title: 'specification.md',
			outputs: [
				{ role: 'researcher', mdFileName: 'market-research.md', mdFilePath: '/w/.division/market-research.md', content: '# マーケットリサーチ\n' },
				{ role: 'writer', mdFileName: 'specification.md', mdFilePath: '/w/.division/specification.md', content: '# 仕様\n' },
			],
		};
		expect(editedOutputsOf(review, {})).toBeUndefined();
		expect(editedOutputsOf(review, { 'market-research.md': '# マーケットリサーチ\r\n' })).toBeUndefined();
		expect(isEdited('a\n', 'a\r\n')).toBe(false);
		expect(editedOutputsOf(review, { 'specification.md': '# 仕様 (直した)\n' })).toEqual([
			{ mdFileName: 'market-research.md', mdContent: '# マーケットリサーチ\n' },
			{ mdFileName: 'specification.md', mdContent: '# 仕様 (直した)\n' },
		]);
	});
});
