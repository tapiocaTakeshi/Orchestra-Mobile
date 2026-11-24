/**
 * PC の .division の文書 (マーケットリサーチ・仕様書・デザイン・各ロールの成果物) をスマホで見る・直すための小さな道具。
 *   - マーケットリサーチ … .division/market-research.md (searcher / researcher が書く。市場規模・競合・ターゲットユーザー・価格・トレンドを出典つきで)
 *     旧名の .division/paper.md (種類 "paper") もマーケットリサーチとして扱う
 *   - 仕様書 … .division/specification.md (writer が書く)
 *   - デザイン … .division/design/<画面>.html (designer が書く。index.html が先頭)
 *   - ワークフロー … .division/workflow.json (leader の計画の図。クラウドのセッションの文書に載る)
 * PC の文書もクラウドのセッションの文書も、同じ形 (RemoteDocument) で扱う (lib/documentSource.ts)。
 */

import type { DocumentKind, EditedOutput, RemoteDocument, ReviewOutputs } from '../api/types';
import type { IconName } from '../components/ui';

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
	workflow: 'ワークフロー',
	'market-research': 'マーケットリサーチ',
	specification: '仕様書',
	design: 'デザイン',
	output: '成果物',
};

export const DOCUMENT_KIND_ICON: Record<DocumentKind, IconName> = {
	workflow: 'git-branch',
	'market-research': 'book-open',
	specification: 'file-text',
	design: 'layout',
	output: 'file',
};

export const isHtmlPath = (path: string): boolean => /\.html?$/i.test(path);

/** マーケットリサーチのファイル名。旧名の paper.md も受け付ける */
export const MARKET_RESEARCH_FILES = ['market-research.md', 'paper.md'];

/** 成果物のファイル名 (例: market-research.md, design/index.html) から文書の種類 */
export const documentKindOf = (name: string): DocumentKind => {
	const base = name.replace(/^\.division\//, '');
	if (base === 'workflow.json') return 'workflow';
	if (MARKET_RESEARCH_FILES.includes(base)) return 'market-research';
	if (base === 'specification.md') return 'specification';
	if (base.startsWith('design/') || /^DESIGN\.html?$/i.test(base)) return 'design';
	return 'output';
};

const DOCUMENT_KINDS: DocumentKind[] = ['workflow', 'market-research', 'specification', 'design', 'output'];

/**
 * PC / クラウドが返す文書の種類を揃える。旧名の "paper" はマーケットリサーチ。知らない種類は名前から決め、
 * それでも分からなければ成果物 (output)。古いサーバーが market-research.md を output と返しても拾う
 */
export const normalizeDocumentKind = (kind: unknown, name?: string): DocumentKind => {
	if (kind === 'paper') return 'market-research';
	if (DOCUMENT_KINDS.includes(kind as DocumentKind) && kind !== 'output') return kind as DocumentKind;
	const byName = name ? documentKindOf(name) : 'output';
	return byName === 'market-research' ? byName : DOCUMENT_KINDS.includes(kind as DocumentKind) ? (kind as DocumentKind) : 'output';
};

/** 一覧の見出し (マーケットリサーチ・仕様書はその名前、デザインはページ名) */
export const documentTitle = (doc: Pick<RemoteDocument, 'kind' | 'name'> & { path?: string }): string => {
	const base = doc.kind === 'workflow' || doc.kind === 'market-research' || doc.kind === 'specification'
		? DOCUMENT_KIND_LABEL[doc.kind]
		: doc.name.replace(/^design\//, '');
	// 複数リポジトリのクラウドセッションは、各リポジトリの .division (<repo>/.division/…) も一覧に載る
	const repo = documentRepoOf(doc.path);
	return repo ? `${repo} · ${base}` : base;
};

/** リポジトリのフォルダの .division の文書ならそのフォルダ名 ('Orchestra-Mobile/.division/CODER.md' → 'Orchestra-Mobile')。ワークスペース直下なら '' */
export const documentRepoOf = (path: string | undefined): string => {
	const m = path ? /^([^/.][^/]*)\/\.division\//.exec(path) : null;
	return m ? m[1] : '';
};

/** 種類ごとにまとめる (ワークフロー → マーケットリサーチ → 仕様書 → デザイン → 成果物) */
export const groupDocuments = (docs: RemoteDocument[]): { kind: DocumentKind; docs: RemoteDocument[] }[] =>
	DOCUMENT_KINDS
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
