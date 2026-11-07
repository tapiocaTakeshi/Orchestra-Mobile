/**
 * 論文・仕様書・デザイン・成果物を「プレビュー / 編集」で見せる。
 *   - Markdown (論文・仕様書・成果物) … Markdown で描く
 *   - デザインの HTML ページ … そのまま描く (HtmlPreview)
 *   - Designer の出力 (```html <ページ名> のブロックが並んだもの) … ページに分けて、ページごとに描く
 * 編集は全文をそのまま直す (保存・承認は呼び出し側)。
 */

import React, { useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { ChipGroup, Input, Muted, SegmentedControl } from './ui';
import { HtmlPreview } from './HtmlPreview';
import { Markdown } from './Markdown';
import { colors, fontSize, spacing } from '../theme';
import { splitDesignPages } from '../lib/designPages';
import { documentFormat, inlineStylesheets, withViewport } from '../lib/divisionDocs';

export type DocumentMode = 'preview' | 'edit';

export const DocumentView = ({ name, value, onChangeText, editable = true, mode: modeProp, onModeChange, css, height = 420 }: {
	/** ファイル名 (例: paper.md, design/index.html)。描き方を決める */
	name: string;
	value: string;
	onChangeText?: (text: string) => void;
	editable?: boolean;
	mode?: DocumentMode;
	onModeChange?: (mode: DocumentMode) => void;
	/** HTML が読む CSS (href → 中身) */
	css?: Record<string, string>;
	/** プレビュー / 編集欄の高さ */
	height?: number;
}) => {
	const [ownMode, setOwnMode] = useState<DocumentMode>('preview');
	const mode = modeProp ?? ownMode;
	const setMode = (m: DocumentMode) => { setOwnMode(m); onModeChange?.(m); };
	const format = documentFormat(name, value);
	const pages = useMemo(() => (format === 'pages' ? splitDesignPages(value) : []), [format, value]);
	const [page, setPage] = useState<string | null>(null);
	const current = pages.find(p => p.name === page) ?? pages[0];

	return (
		<View style={styles.root}>
			{editable && onChangeText ? (
				<SegmentedControl
					options={[{ value: 'preview', label: 'プレビュー' }, { value: 'edit', label: '編集' }]}
					value={mode}
					onChange={setMode}
				/>
			) : null}
			{mode === 'edit' && editable && onChangeText ? (
				<Input
					value={value}
					onChangeText={onChangeText}
					multiline
					autoCapitalize='none'
					autoCorrect={false}
					spellCheck={false}
					textAlignVertical='top'
					accessibilityLabel={`${name} を編集`}
					style={[styles.editor, { height }]}
				/>
			) : format === 'html' ? (
				<HtmlPreview html={withViewport(inlineStylesheets(value, css ?? {}))} style={{ height }} accessibilityLabel={`${name} のプレビュー`} />
			) : format === 'pages' ? (
				<>
					{pages.length > 1 ? (
						<ChipGroup options={pages.map(p => ({ value: p.name, label: p.name }))} value={current?.name ?? null} onChange={setPage} />
					) : null}
					{current ? <HtmlPreview html={withViewport(current.html)} style={{ height }} accessibilityLabel={`${current.name} のプレビュー`} /> : <Muted>ページがありません。</Muted>}
				</>
			) : (
				<ScrollView style={[styles.markdown, { maxHeight: height }]} nestedScrollEnabled accessibilityLabel={`${name} のプレビュー`}>
					{value.trim() ? <Markdown text={value} textStyle={styles.text} /> : <Muted>(空です)</Muted>}
				</ScrollView>
			)}
		</View>
	);
};

const styles = StyleSheet.create({
	root: { gap: spacing.sm },
	editor: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 13, lineHeight: 19 },
	markdown: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.bgElevated, padding: spacing.md },
	text: { fontSize: fontSize.sm, lineHeight: 22, color: colors.fg },
});
