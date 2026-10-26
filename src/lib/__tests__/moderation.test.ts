/**
 * 不適切な語のフィルタ。サーバー (contains_objectionable_text) と同じく、英語の語は単語単位、
 * 日本語の語はどこに含まれていても一致することを確かめる。
 */

import {
	OBJECTIONABLE_CONTENT_MESSAGE,
	OBJECTIONABLE_TERMS,
	REPORT_REASONS,
	blockedUserLabel,
	containsObjectionableText,
	isObjectionablePost,
	isReportReason,
	validatePostText,
} from '../moderation';

describe('containsObjectionableText', () => {
	it('matches Latin terms as whole words, case-insensitively', () => {
		expect(containsObjectionableText('what the fuck')).toBe(true);
		expect(containsObjectionableText('Shit happens')).toBe(true);
		expect(containsObjectionableText('BITCH!')).toBe(true);
		expect(containsObjectionableText('(porn)')).toBe(true);
		expect(containsObjectionableText('fuck_')).toBe(false);
	});

	it('matches multi-word terms', () => {
		expect(containsObjectionableText('just kill yourself')).toBe(true);
		expect(containsObjectionableText('skill yourself up')).toBe(false);
	});

	it('does not match Latin terms inside other words', () => {
		expect(containsObjectionableText('class')).toBe(false);
		expect(containsObjectionableText('grape')).toBe(false);
		expect(containsObjectionableText('this hit the spot')).toBe(false);
		expect(containsObjectionableText('Scunthorpe')).toBe(false);
		expect(containsObjectionableText('pornography')).toBe(false);
		expect(containsObjectionableText('shitake')).toBe(false);
		expect(containsObjectionableText('assholes')).toBe(false);
	});

	it('finds a whole-word match after an embedded one', () => {
		expect(containsObjectionableText('shitake and shit')).toBe(true);
	});

	it('matches Japanese terms anywhere in the text', () => {
		expect(containsObjectionableText('お前は死ね')).toBe(true);
		expect(containsObjectionableText('マジでキモいわ')).toBe(true);
		expect(containsObjectionableText('今すぐ消えろよ')).toBe(true);
		expect(containsObjectionableText('コスト重視の構成')).toBe(false);
		expect(containsObjectionableText('レビュー担当に gpt-5.4 を割り当て')).toBe(false);
	});

	it('treats empty input as clean', () => {
		expect(containsObjectionableText('')).toBe(false);
		expect(containsObjectionableText(null)).toBe(false);
		expect(containsObjectionableText(undefined)).toBe(false);
	});

	it('accepts a custom term list', () => {
		expect(containsObjectionableText('foo bar', ['bar'])).toBe(true);
		expect(containsObjectionableText('foobar', ['bar'])).toBe(false);
		expect(containsObjectionableText('anything', ['  '])).toBe(false);
	});

	it('mirrors the server seed list', () => {
		expect(OBJECTIONABLE_TERMS).toHaveLength(28);
		expect(new Set(OBJECTIONABLE_TERMS).size).toBe(OBJECTIONABLE_TERMS.length);
	});
});

describe('isObjectionablePost / validatePostText', () => {
	const clean = { title: 'コスト重視', description: '安いモデル中心', authorName: '山田' };

	it('checks the title, description and author name', () => {
		expect(isObjectionablePost(clean)).toBe(false);
		expect(isObjectionablePost({ ...clean, title: 'fuck this' })).toBe(true);
		expect(isObjectionablePost({ ...clean, description: '死ね' })).toBe(true);
		expect(isObjectionablePost({ ...clean, authorName: 'asshole' })).toBe(true);
	});

	it('returns the user-facing message only when something matches', () => {
		expect(validatePostText(clean)).toBeNull();
		expect(validatePostText({ title: 'class notes' })).toBeNull();
		expect(validatePostText({ description: 'クソ構成。死ね' })).toBe(OBJECTIONABLE_CONTENT_MESSAGE);
		expect(OBJECTIONABLE_CONTENT_MESSAGE).toBe('不適切な表現が含まれているため投稿できません。');
	});
});

describe('report reasons', () => {
	it('lists the reasons the moderation function accepts, with Japanese labels', () => {
		expect(REPORT_REASONS.map(r => r.value)).toEqual(['spam', 'harassment', 'hate', 'sexual', 'violence', 'illegal', 'other']);
		expect(REPORT_REASONS.map(r => r.label)).toEqual([
			'スパム', '嫌がらせ・誹謗中傷', '差別・ヘイト', '性的なコンテンツ', '暴力的なコンテンツ', '違法なコンテンツ', 'その他',
		]);
		expect(isReportReason('hate')).toBe(true);
		expect(isReportReason('blocked')).toBe(false);
		expect(isReportReason(undefined)).toBe(false);
	});

	it('labels blocked users without a name', () => {
		expect(blockedUserLabel(null)).toBe('名無し');
		expect(blockedUserLabel('  ')).toBe('名無し');
		expect(blockedUserLabel('佐藤')).toBe('佐藤');
	});
});
