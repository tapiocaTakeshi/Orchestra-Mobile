/**
 * エージェントの返答を Markdown として描く。解析は lib/markdown.ts。
 * 飾りは Claude Code / ChatGPT のアプリに合わせて控えめにする: 見出しは太さと大きさだけ、
 * コードは一段明るい地の等幅、引用は左の線だけ。
 */

import React from 'react';
import { Linking, Platform, ScrollView, StyleProp, StyleSheet, Text, TextStyle, View } from 'react-native';

import { MdBlock, MdInline, parseMarkdown } from '../lib/markdown';
import { colors, fontSize, radius, spacing } from '../theme';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const openLink = (url: string) => {
	if (/^https?:\/\//i.test(url)) void Linking.openURL(url).catch(() => undefined);
};

const Inline = ({ nodes }: { nodes: MdInline[] }) => (
	<>
		{nodes.map((n, i) => {
			switch (n.type) {
				case 'text': return n.text;
				case 'bold': return <Text key={i} style={styles.bold}><Inline nodes={n.children} /></Text>;
				case 'italic': return <Text key={i} style={styles.italic}><Inline nodes={n.children} /></Text>;
				case 'strike': return <Text key={i} style={styles.strike}><Inline nodes={n.children} /></Text>;
				case 'code': return <Text key={i} style={styles.inlineCode}>{n.text}</Text>;
				case 'link': return <Text key={i} style={styles.link} accessibilityRole='link' onPress={() => openLink(n.url)}><Inline nodes={n.children} /></Text>;
			}
		})}
	</>
);

const HEADING_STYLES: TextStyle[] = [
	{ fontSize: fontSize.md + 2, lineHeight: 28 },
	{ fontSize: fontSize.md + 1, lineHeight: 26 },
	{ fontSize: fontSize.md, lineHeight: 25 },
	{ fontSize: fontSize.sm, lineHeight: 24 },
];

const Block = ({ block, textStyle }: { block: MdBlock; textStyle: StyleProp<TextStyle> }) => {
	switch (block.type) {
		case 'heading':
			return (
				<Text selectable accessibilityRole='header' style={[textStyle, styles.heading, HEADING_STYLES[Math.min(block.level, 4) - 1]]}>
					<Inline nodes={block.children} />
				</Text>
			);
		case 'paragraph':
			return <Text selectable style={textStyle}><Inline nodes={block.children} /></Text>;
		case 'list':
			return (
				<View style={styles.list}>
					{block.items.map((item, i) => (
						<View key={i} style={styles.listItem}>
							<Text style={[textStyle, styles.marker]}>
								{item.checked !== undefined ? (item.checked ? '☑' : '☐') : block.ordered ? `${block.start + i}.` : '•'}
							</Text>
							<Text selectable style={[textStyle, styles.flex, item.checked && styles.done]}><Inline nodes={item.children} /></Text>
						</View>
					))}
				</View>
			);
		case 'quote':
			return (
				<View style={styles.quote}>
					{block.blocks.map((b, i) => <Block key={i} block={b} textStyle={[textStyle, styles.quoteText]} />)}
				</View>
			);
		case 'code':
			return (
				<ScrollView horizontal style={styles.codeBlock} contentContainerStyle={styles.codeContent}>
					<Text selectable style={styles.codeText}>{block.text}</Text>
				</ScrollView>
			);
		case 'table':
			return (
				<ScrollView horizontal style={styles.table}>
					<View>
						{[block.header, ...block.rows].map((row, r) => (
							<View key={r} style={[styles.tableRow, r === 0 && styles.tableHead]}>
								{row.map((cell, c) => (
									<Text key={c} selectable style={[styles.tableCell, r === 0 && styles.bold]}><Inline nodes={cell} /></Text>
								))}
							</View>
						))}
					</View>
				</ScrollView>
			);
		case 'rule':
			return <View style={styles.rule} />;
	}
};

export const Markdown = ({ text, textStyle }: { text: string; textStyle: StyleProp<TextStyle> }) => {
	const blocks = React.useMemo(() => parseMarkdown(text), [text]);
	return (
		<View style={styles.root}>
			{blocks.map((b, i) => <Block key={i} block={b} textStyle={textStyle} />)}
		</View>
	);
};

const styles = StyleSheet.create({
	root: { gap: spacing.sm + 2 },
	flex: { flex: 1 },
	heading: { color: colors.fgStrong, fontWeight: '700', marginTop: spacing.xs },
	bold: { fontWeight: '700', color: colors.fgStrong },
	italic: { fontStyle: 'italic' },
	strike: { textDecorationLine: 'line-through' },
	done: { color: colors.fgFaint },
	inlineCode: { fontFamily: MONO, fontSize: fontSize.xs + 1, color: colors.fgStrong, backgroundColor: colors.bgElevated },
	link: { color: colors.accentText, textDecorationLine: 'underline' },
	list: { gap: spacing.xs },
	listItem: { flexDirection: 'row', gap: spacing.sm },
	marker: { minWidth: 16, color: colors.fgMuted },
	quote: { gap: spacing.xs, paddingLeft: spacing.md, borderLeftWidth: 3, borderLeftColor: colors.borderStrong },
	quoteText: { color: colors.fgMuted },
	codeBlock: { borderRadius: radius.md, backgroundColor: colors.bgElevated, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
	codeContent: { padding: spacing.md },
	codeText: { fontFamily: MONO, fontSize: fontSize.xs, lineHeight: 18, color: colors.fg },
	table: { borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong },
	tableRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
	tableHead: { borderTopWidth: 0, backgroundColor: colors.bgElevated },
	tableCell: { minWidth: 80, maxWidth: 240, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs + 2, color: colors.fg, fontSize: fontSize.xs + 1, lineHeight: 19 },
	rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong, marginVertical: spacing.xs },
});
