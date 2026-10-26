/**
 * 利用規約 (EULA) の表示と同意。
 *
 * App Store Review Guideline 1.2 のため、ログイン前に規約の全文をアプリ内で読めるようにし、
 * 同意しないとログインできないようにする。
 *   - TermsContent    … 規約の全文 (lib/legal.ts) と Web 版・プライバシーポリシーへのリンク
 *   - TermsSheet      … ログイン画面の「利用規約」から開くシート。「同意する」で閉じる
 *   - TermsAgreementGate … ログイン済みでも同意した版が古い (規約の更新後) ときに出す全画面
 *   - TermsCheckbox   … ログイン画面の「利用規約に同意します」のチェック
 */

import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CONTACT_URL, PRIVACY_URL, TERMS_SECTIONS, TERMS_TITLE, TERMS_URL, TERMS_VERSION } from '../lib/legal';
import { colors, fontSize, radius, spacing } from '../theme';
import { Button, Icon, Sheet } from './ui';

const openUrl = (url: string) => { void Linking.openURL(url).catch(() => undefined); };

export const LegalLinks = () => (
	<View style={styles.links}>
		<Pressable accessibilityRole='link' accessibilityLabel='利用規約を Web で開く' hitSlop={6} onPress={() => openUrl(TERMS_URL)}>
			<Text style={styles.link}>利用規約 (Web)</Text>
		</Pressable>
		<Text style={styles.linkSeparator}>·</Text>
		<Pressable accessibilityRole='link' accessibilityLabel='プライバシーポリシーを開く' hitSlop={6} onPress={() => openUrl(PRIVACY_URL)}>
			<Text style={styles.link}>プライバシーポリシー</Text>
		</Pressable>
		<Text style={styles.linkSeparator}>·</Text>
		<Pressable accessibilityRole='link' accessibilityLabel='お問い合わせを開く' hitSlop={6} onPress={() => openUrl(CONTACT_URL)}>
			<Text style={styles.link}>お問い合わせ</Text>
		</Pressable>
	</View>
);

/** 規約の全文。スクロールはしない (置く側の ScrollView に入れる)。 */
export const TermsContent = () => (
	<View style={styles.terms}>
		<Text style={styles.version}>{TERMS_VERSION} 版</Text>
		{TERMS_SECTIONS.map(section => (
			<View key={section.heading} style={styles.section}>
				<Text accessibilityRole='header' style={styles.heading}>{section.heading}</Text>
				{section.body.map((paragraph, index) => (
					<Text key={index} style={styles.paragraph}>{paragraph}</Text>
				))}
			</View>
		))}
		<LegalLinks />
	</View>
);

export const TermsSheet = ({ onClose, onAgree }: { onClose: () => void; onAgree?: () => void }) => (
	<Sheet title={TERMS_TITLE} eyebrow='利用規約' onClose={onClose}>
		<ScrollView contentContainerStyle={styles.sheetContent}>
			<TermsContent />
			{onAgree ? (
				<Button title='同意する' icon='check' onPress={() => { onAgree(); onClose(); }} style={styles.agreeButton} />
			) : null}
		</ScrollView>
	</Sheet>
);

/** 「利用規約に同意します」。規約の名前を押すと全文を開く。 */
export const TermsCheckbox = ({ checked, onToggle, onOpenTerms }: {
	checked: boolean;
	onToggle: () => void;
	onOpenTerms: () => void;
}) => (
	<View style={styles.checkRow}>
		<Pressable
			accessibilityRole='checkbox'
			accessibilityLabel='利用規約に同意します'
			accessibilityState={{ checked }}
			hitSlop={8}
			onPress={onToggle}
			style={[styles.checkbox, checked && styles.checkboxChecked]}
		>
			{checked ? <Icon name='check' size={16} color={colors.bg} /> : null}
		</Pressable>
		<Text style={styles.checkText} onPress={onToggle}>
			<Text accessibilityRole='link' style={styles.link} onPress={onOpenTerms}>利用規約</Text>
			に同意します。不適切なコンテンツや迷惑行為は一切認められません。
		</Text>
	</View>
);

/** ログイン済みで、同意した規約の版が古いか未同意のとき。同意するまで先に進めない。 */
export const TermsAgreementGate = ({ onAgree, onLogout, busy }: {
	onAgree: () => void;
	onLogout: () => void;
	busy?: boolean;
}) => (
	<View style={styles.gate}>
		<View style={styles.gateHeader}>
			<Text accessibilityRole='header' style={styles.gateTitle}>利用規約が更新されました</Text>
			<Text style={styles.gateDetail}>Orchestra を続けて使うには、最新の利用規約を読んで同意してください。</Text>
		</View>
		<ScrollView style={styles.gateScroll} contentContainerStyle={styles.sheetContent}>
			<Text style={styles.gateDocTitle}>{TERMS_TITLE}</Text>
			<TermsContent />
		</ScrollView>
		<View style={styles.gateFooter}>
			<Button title='同意して続ける' icon='check' onPress={onAgree} loading={busy} />
			<Button title='同意せずにログアウト' variant='ghost' onPress={onLogout} disabled={busy} />
		</View>
	</View>
);

const styles = StyleSheet.create({
	terms: { gap: spacing.lg },
	version: { color: colors.fgFaint, fontSize: fontSize.xs },
	section: { gap: spacing.sm },
	heading: { color: colors.fgStrong, fontSize: fontSize.sm, fontWeight: '600' },
	paragraph: { color: colors.fg, fontSize: fontSize.xs + 1, lineHeight: 21 },
	links: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
	link: { color: colors.accentText, fontSize: fontSize.xs + 1, textDecorationLine: 'underline' },
	linkSeparator: { color: colors.fgFaint, fontSize: fontSize.xs },
	sheetContent: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg },
	agreeButton: { marginTop: spacing.sm },
	checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginTop: spacing.md },
	checkbox: {
		width: 24,
		height: 24,
		borderRadius: radius.sm,
		borderWidth: 1.5,
		borderColor: colors.fgFaint,
		alignItems: 'center',
		justifyContent: 'center',
	},
	checkboxChecked: { backgroundColor: colors.fg, borderColor: colors.fg },
	checkText: { flex: 1, color: colors.fgMuted, fontSize: fontSize.xs + 1, lineHeight: 21 },
	gate: { flex: 1 },
	gateHeader: {
		gap: spacing.xs,
		paddingHorizontal: spacing.lg,
		paddingVertical: spacing.lg,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.borderStrong,
	},
	gateTitle: { color: colors.fgStrong, fontSize: fontSize.lg, fontWeight: '600' },
	gateDetail: { color: colors.fgMuted, fontSize: fontSize.xs + 1, lineHeight: 21 },
	gateScroll: { flex: 1 },
	gateDocTitle: { color: colors.fgStrong, fontSize: fontSize.md, fontWeight: '600' },
	gateFooter: {
		gap: spacing.xs,
		padding: spacing.lg,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: colors.borderStrong,
	},
});
