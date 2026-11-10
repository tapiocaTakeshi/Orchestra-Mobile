/**
 * ページを見ているあいだに PC のツール実行が確認待ちになったとき、上に出す細い帯 (FR-018)。
 * 状態は色だけでなく形のあるアイコンと文言でも示し、押せる枠は高さ 44 を確保する。
 * 文字拡大では高さが伸びて折り返す。
 */

import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Icon } from './ui';
import { colors, fontSize, spacing } from '../theme';

export const APPROVAL_BAR_LABEL = 'ツールの実行が確認待ちです。チャットへ';

export const ApprovalBar = ({ onPress }: { onPress: () => void }) => (
	<Pressable
		accessibilityRole='button'
		accessibilityLabel={APPROVAL_BAR_LABEL}
		onPress={onPress}
		style={styles.approvalBar}
	>
		<Icon name='pause-circle' size={14} color={colors.warning} />
		<Text style={styles.approvalText}>ツールの実行が確認待ちです</Text>
		<Text style={styles.approvalLink}>チャットへ</Text>
		<Icon name='chevron-right' size={14} color={colors.fg} />
	</Pressable>
);

const styles = StyleSheet.create({
	approvalBar: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		minHeight: 44,
		paddingVertical: spacing.xs,
		paddingHorizontal: spacing.lg,
		backgroundColor: colors.bgSidebar,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.border,
	},
	approvalText: { flex: 1, color: colors.fg, fontSize: fontSize.xs + 1 },
	// accentText は bgSidebar 上で 4.26:1 と足りないため、濃い文字色＋下線と矢印で導線を示す
	approvalLink: { color: colors.fgStrong, fontSize: fontSize.xs + 1, fontWeight: '600', textDecorationLine: 'underline' },
});
