/**
 * PC の .division の文書 (論文・仕様書・デザイン・各ロールの成果物) をスマホで見る・直すための小さな道具。
 *   - 論文 … .division/paper.md (searcher / researcher が書く)
 *   - 仕様書 … .division/specification.md (writer が書く)
 *   - デザイン … .division/design/<画面>.html (designer が書く。index.html が先頭)
 *   - ワークフロー … .division/workflow.json (leader の計画の図。クラウドのセッションの文書に載る)
 * PC の文書もクラウドのセッションの文書も、同じ形 (RemoteDocument) で扱う (lib/documentSource.ts)。
 */

import type { DocumentKind, EditedOutput, RemoteDocument, ReviewOutputs } from '../api/types';
import type { IconName } from '../components/ui';

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
	workflow: 'ワークフロー',
	paper: '論文',
	specification: '仕様書',
	design: 'デザイン',
	output: '成果物',
};

export const DOCUMENT_KIND_ICON: Record<DocumentKind, IconName> = {
	workflow: 'git-branch',
	paper: 'book-open',
	specification: 'file-text',
	design: 'layout',
	output: 'file',
};

export const isHtmlPath = (path: string): boolean => /\.html?$/i.test(path);

/** 成果物のファイル名 (例: paper.md, design/index.html) から文書の種類 */
export const documentKindOf = (name: string): DocumentKind => {
	const base = name.replace(/^\.division\//, '');
	if (base === 'workflow.json') return 'workflow';
	if (base === 'paper.md') return 'paper';
	if (base === 'specification.md') return 'specification';
	if (base.startsWith('design/') || /^DESIGN\.html?$/i.test(base)) return 'design';
	return 'output';
};

/** 一覧の見出し (論文・仕様書はその名前、デザインはページ名) */
export const documentTitle = (doc: Pick<RemoteDocument, 'kind' | 'name'>): string => {
	if (doc.kind === 'workflow' || doc.kind === 'paper' || doc.kind === 'specification') return DOCUMENT_KIND_LABEL[doc.kind];
	return doc.name.replace(/^design\//, '');
};

/** 種類ごとにまとめる (ワークフロー → 論文 → 仕様書 → デザイン → 成果物) */
export const groupDocuments = (docs: RemoteDocument[]): { kind: DocumentKind; docs: RemoteDocument[] }[] =>
	(['workflow', 'paper', 'specification', 'design', 'output'] as DocumentKind[])
		.map(kind => ({ kind, docs: docs.filter(d => d.kind === kind) }))
		.filter(g => g.docs.length > 0);

/** ページの <link rel="stylesheet" href="相対パス"> が読む CSS (http(s)・// で始まるものは除く) */
export const localStylesheets = (html: string): string[] => {
	const out: string[] = [];
	const re = /<link\b[^>]*>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html))) {
		const tag = m[0];
		if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) continue;
		const href = /href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(tag);
		const url = href ? (href[1] ?? href[2] ?? href[3]) : '';
		if (url && !/^(?:[a-z]+:|\/\/|#)/i.test(url) && !out.includes(url)) out.push(url);
	}
	return out;
};

/** ページのフォルダ (.division/design/index.html → .division/design) から相対パスを解く */
export const resolveRelative = (fromPath: string, href: string): string => {
	const parts = fromPath.split('/').slice(0, -1);
	for (const seg of href.split(/[?#]/)[0].split('/')) {
		if (!seg || seg === '.') continue;
		if (seg === '..') parts.pop(); else parts.push(seg);
	}
	return parts.join('/');
};

/**
 * スマホのプレビューは PC のファイルを直接読めないので、ページが読む CSS を <style> に埋め込む。
 * css は href → 中身 (読めなかったものは入れない)。
 */
export const inlineStylesheets = (html: string, css: Record<string, string>): string =>
	html.replace(/<link\b[^>]*>/gi, tag => {
		if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
		const href = /href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(tag);
		const url = href ? (href[1] ?? href[2] ?? href[3]) : '';
		return url in css ? `<style data-href="${url.replace(/"/g, '')}">\n${css[url]}\n</style>` : tag;
	});

/** 横幅がスマホでも崩れにくいように viewport が無いページには足す */
export const withViewport = (html: string): string =>
	/<meta[^>]+name\s*=\s*["']?viewport/i.test(html)
		? html
		: /<head[^>]*>/i.test(html)
			? html.replace(/<head[^>]*>/i, h => `${h}\n<meta name="viewport" content="width=device-width, initial-scale=1">`)
			: `<meta name="viewport" content="width=device-width, initial-scale=1">\n${html}`;

/** 編集したかどうか (改行コードの違いは無視) */
export const isEdited = (original: string, edited: string): boolean => original.replace(/\r\n/g, '\n') !== edited.replace(/\r\n/g, '\n');

/** この内容をどう描くか: html (1 ページ) / pages (Designer の出力: ```html <ページ名> のブロック) / markdown */
export const documentFormat = (name: string, content: string): 'html' | 'pages' | 'markdown' => {
	if (isHtmlPath(name) && /^\s*<(!doctype|html|head|body|[a-z])/i.test(content)) return 'html';
	if (/(^|\/)design\//.test(name) || isHtmlPath(name)) return 'pages';
	return 'markdown';
};

/** 承認で送る editedOutputs (編集したものが無ければ undefined = そのまま承認)。編集しなかったものもそのまま入れる */
export const editedOutputsOf = (review: ReviewOutputs, edits: Record<string, string>): EditedOutput[] | undefined => {
	const changed = review.outputs.some(o => edits[o.mdFileName] !== undefined && isEdited(o.content, edits[o.mdFileName]));
	if (!changed) return undefined;
	return review.outputs
		.map(o => ({ mdFileName: o.mdFileName, mdContent: edits[o.mdFileName] ?? o.content }))
		.filter(o => o.mdContent.trim());
};
