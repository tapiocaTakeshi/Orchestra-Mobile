/**
 * ソーシャルの不適切コンテンツ対策のうち、ネットワークに触らない部分。
 *
 * App Store Review Guideline 1.2 (ユーザー生成コンテンツ) のため、
 *   - 不適切な語を含む投稿は公開・更新の前に弾き、フィードにも出さない
 *   - 通報の理由の一覧
 * をここにまとめる。サーバー側 (division-hp の
 * supabase/migrations/20261026_app_review_moderation_iap.sql) でも同じ語で
 * 投稿の書き込みを拒否しているので、こちらは多層防御 (先に分かりやすく断る / 古い投稿を隠す)。
 * 語を足すときはサーバーの "ModerationTerm" テーブルとこの一覧の両方に足すこと。
 */

import type { AssignmentPost } from './social';

/** サーバーの "ModerationTerm" の初期データと同じ語。 */
export const OBJECTIONABLE_TERMS: readonly string[] = [
	'fuck', 'shit', 'bitch', 'cunt', 'asshole', 'motherfucker',
	'nigger', 'faggot', 'retard', 'porn', 'rapist', 'kill yourself',
	'死ね', 'しね', '殺す', 'ころす', '殺してやる', '自殺しろ', '消えろ',
	'きもい', 'キモい', 'ガイジ', '池沼', 'レイプ', 'セックス', 'ちんこ', 'まんこ', '売春',
];

export const OBJECTIONABLE_CONTENT_MESSAGE = '不適切な表現が含まれているため投稿できません。';

/** サーバーと同じ判定: 英数字と空白だけの語は単語単位、それ以外 (日本語) はどこに含まれていても一致。 */
const isLatinTerm = (term: string): boolean => /^[A-Za-z0-9 ]+$/.test(term);

/** 単語の一部とみなす文字 (英数字・_ と、大文字小文字のある文字)。 */
const isWordChar = (ch: string | undefined): boolean => {
	if (!ch) return false;
	if (/[A-Za-z0-9_]/.test(ch)) return true;
	return ch.toLowerCase() !== ch.toUpperCase();
};

const containsWholeWord = (text: string, term: string): boolean => {
	let from = 0;
	for (;;) {
		const index = text.indexOf(term, from);
		if (index < 0) return false;
		if (!isWordChar(text[index - 1]) && !isWordChar(text[index + term.length])) return true;
		from = index + 1;
	}
};

/** 不適切な語を含むか。大文字小文字は区別しない。 */
export const containsObjectionableText = (
	text: string | null | undefined,
	terms: readonly string[] = OBJECTIONABLE_TERMS,
): boolean => {
	if (!text) return false;
	const haystack = text.toLowerCase();
	return terms.some(raw => {
		const term = raw.trim().toLowerCase();
		if (!term) return false;
		return isLatinTerm(term) ? containsWholeWord(haystack, term) : haystack.includes(term);
	});
};

/** サーバーと同じく、タイトル・説明・投稿者名のどれかに含まれていれば不適切とみなす。 */
export const isObjectionablePost = (post: Pick<AssignmentPost, 'title' | 'description' | 'authorName'>): boolean =>
	containsObjectionableText(post.title)
	|| containsObjectionableText(post.description)
	|| containsObjectionableText(post.authorName);

/** 公開・更新の前の確認。問題があれば利用者向けの文言を返す。 */
export const validatePostText = (fields: { title?: string | null; description?: string | null; authorName?: string | null }): string | null =>
	(containsObjectionableText(fields.title) || containsObjectionableText(fields.description) || containsObjectionableText(fields.authorName))
		? OBJECTIONABLE_CONTENT_MESSAGE
		: null;

// ---------------------------------------------------------------------------
// 通報
// ---------------------------------------------------------------------------

export type ReportReason = 'spam' | 'harassment' | 'hate' | 'sexual' | 'violence' | 'illegal' | 'other';

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
	{ value: 'spam', label: 'スパム' },
	{ value: 'harassment', label: '嫌がらせ・誹謗中傷' },
	{ value: 'hate', label: '差別・ヘイト' },
	{ value: 'sexual', label: '性的なコンテンツ' },
	{ value: 'violence', label: '暴力的なコンテンツ' },
	{ value: 'illegal', label: '違法なコンテンツ' },
	{ value: 'other', label: 'その他' },
];

export const REPORT_DETAILS_MAX = 1000;

export const isReportReason = (value: unknown): value is ReportReason =>
	REPORT_REASONS.some(r => r.value === value);

/** ブロック済みの利用者の名前が無いときの表示。 */
export const blockedUserLabel = (name: string | null | undefined): string => name?.trim() || '名無し';
