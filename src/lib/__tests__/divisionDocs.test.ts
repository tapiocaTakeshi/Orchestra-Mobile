import type { RemoteDocument, ReviewOutputs } from '../../api/types';
import { splitDesignPages } from '../designPages';
import {
	documentFormat, documentKindOf, documentTitle, editedOutputsOf, groupDocuments, inlineStylesheets, isEdited, localStylesheets, resolveRelative, withViewport,
} from '../divisionDocs';

describe('divisionDocs', () => {
	it('tells the paper, the specification, the design and other outputs apart', () => {
		expect(documentKindOf('paper.md')).toBe('paper');
		expect(documentKindOf('.division/specification.md')).toBe('specification');
		expect(documentKindOf('design/index.html')).toBe('design');
		expect(documentKindOf('DESIGN.html')).toBe('design');
		expect(documentKindOf('REVIEW.md')).toBe('output');
		expect(documentTitle({ kind: 'paper', name: 'paper.md' })).toBe('論文');
		expect(documentTitle({ kind: 'design', name: 'design/login.html' })).toBe('login.html');
	});

	it('groups documents in the order paper → specification → design → outputs', () => {
		const doc = (name: string, kind: RemoteDocument['kind']): RemoteDocument => ({ path: `.division/${name}`, name, kind, size: 1, mtime: 1 });
		const groups = groupDocuments([doc('REVIEW.md', 'output'), doc('design/index.html', 'design'), doc('specification.md', 'specification'), doc('paper.md', 'paper')]);
		expect(groups.map(g => g.kind)).toEqual(['paper', 'specification', 'design', 'output']);
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
		expect(documentFormat('paper.md', '# 論文')).toBe('markdown');
		expect(splitDesignPages('```html index.html\n<html><body>a</body></html>\n```\n```html login.html\n<html><body>b</body></html>\n```').map(p => p.name)).toEqual(['index.html', 'login.html']);
	});

	it('sends edited outputs only when something was edited, with the others unchanged', () => {
		const review: ReviewOutputs = {
			flowRole: 'writer',
			title: 'specification.md',
			outputs: [
				{ role: 'researcher', mdFileName: 'paper.md', mdFilePath: '/w/.division/paper.md', content: '# 論文\n' },
				{ role: 'writer', mdFileName: 'specification.md', mdFilePath: '/w/.division/specification.md', content: '# 仕様\n' },
			],
		};
		expect(editedOutputsOf(review, {})).toBeUndefined();
		expect(editedOutputsOf(review, { 'paper.md': '# 論文\r\n' })).toBeUndefined();
		expect(isEdited('a\n', 'a\r\n')).toBe(false);
		expect(editedOutputsOf(review, { 'specification.md': '# 仕様 (直した)\n' })).toEqual([
			{ mdFileName: 'paper.md', mdContent: '# 論文\n' },
			{ mdFileName: 'specification.md', mdContent: '# 仕様 (直した)\n' },
		]);
	});
});
