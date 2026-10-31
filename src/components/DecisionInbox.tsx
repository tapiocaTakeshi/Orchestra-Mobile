/**
 * ホームの一覧の上に出す「判断が必要な項目」(Decision Inbox)。
 *
 * セッションのログを 1 つずつ開かなくても、承認待ち・変更の確認待ち・失敗と、監視中のリポジトリで
 * 検出された CI 失敗・修正依頼がここに集まる。各カードは「何が起きたか / 根拠 / 推奨 / まだ不確かなこと」と、
 * その場で取れる操作 (成果物を開く・AI に調査させる・対応不要) だけを出す。
 *
 * 「AI に調査・修正させる」は、サーバーが用意した調査用の指示 (Context Packet) とリポジトリで
 * クラウドセッションを起動し、その項目を「AI が対応中」にする。PR の作成・承認は必ずセッションの画面で行う。
 *
 * 項目が無いとき・サーバーが未対応のときは何も描かない (ホームを邪魔しない)。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, Muted, useToast } from './ui';
import { DivisionSession } from '../lib/divisionAuth';
import { CloudSession, cloudErrorText, launchSessions } from '../lib/divisionCloud';
import {
	DECISION_KIND_LABELS,
	Decision,
	DecisionOption,
	decisionColor,
	dismissDecision,
	isInboxUnsupported,
	listDecisions,
	markInvestigating,
	openCount,
	primaryOption,
	secondaryOptions,
} from '../lib/divisionDecisions';
import { colors, fontSize, radius, spacing, withAlpha } from '../theme';

/** 畳んでいるときに見せる枚数。 */
const COLLAPSED = 3;
/** 検出された項目を読み直す間隔。 */
const SIGNAL_POLL_MS = 60_000;

const DecisionCard = ({ decision, busy, onOption }: {
	decision: Decision;
	busy: boolean;
	onOption: (option: DecisionOption) => void;
}) => {
	const color = decisionColor(decision);
	const primary = primaryOption(decision);
	const secondary = secondaryOptions(decision);
	const working = decision.status === 'in_progress';
	return (
		<View style={styles.card} accessible={false}>
			<View style={styles.cardHead}>
				<View style={[styles.kind, { backgroundColor: withAlpha(color, '22') }]}>
					<Text style={[styles.kindText, { color }]}>{working ? 'AI が対応中' : DECISION_KIND_LABELS[decision.kind]}</Text>
				</View>
				<Text style={styles.cardTitle} numberOfLines={2}>{decision.title}</Text>
			</View>
			{decision.summary ? <Muted style={styles.cardText} numberOfLines={3}>{decision.summary}</Muted> : null}
			{decision.evidence.length ? (
				<View style={styles.evidence}>
					{decision.evidence.slice(0, 3).map((e, i) => (
						<Pressable
							key={`${e.label}-${i}`}
							disabled={!e.url}
							onPress={() => e.url && void Linking.openURL(e.url)}
							accessibilityRole={e.url ? 'link' : undefined}
							style={styles.evidenceRow}
						>
							<Icon name={e.url ? 'external-link' : 'info'} size={12} color={colors.fgFaint} />
							<Text style={[styles.evidenceText, e.url && { color: colors.accentText }]} numberOfLines={1}>
								{e.label}{e.detail ? `: ${e.detail}` : ''}
							</Text>
						</Pressable>
					))}
				</View>
			) : null}
			{decision.risks.map(r => (
				<View key={r} style={styles.riskRow}>
					<Icon name='alert-triangle' size={12} color={colors.warning} />
					<Text style={styles.riskText}>{r}</Text>
				</View>
			))}
			{!working && decision.recommendation ? <Text style={styles.recommendation}>推奨: {decision.recommendation}</Text> : null}
			{primary || secondary.length ? (
				<View style={styles.actions}>
					{primary ? (
						<Pressable
							accessibilityRole='button'
							disabled={busy}
							onPress={() => onOption(primary)}
							style={({ pressed }) => [styles.primary, (pressed || busy) && styles.pressed]}
						>
							{busy ? <ActivityIndicator size='small' color={colors.bg} /> : <Text style={styles.primaryText}>{primary.label}</Text>}
						</Pressable>
					) : null}
					{secondary.map(o => (
						<Pressable
							key={`${o.id}-${o.label}`}
							accessibilityRole='button'
							disabled={busy}
							onPress={() => onOption(o)}
							style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
						>
							<Text style={styles.secondaryText}>{o.label}</Text>
						</Pressable>
					))}
				</View>
			) : null}
		</View>
	);
};

export const DecisionInbox = ({ auth, refreshKey, onOpenSession, onSessionStarted }: {
	auth: DivisionSession;
	/** 変わるたびに読み直す (セッションの状態が変わったとき・引っ張って更新したとき) */
	refreshKey: string;
	/** セッションの画面を開く (承認・差分・PR 作成はそこで行う) */
	onOpenSession: (sessionId: string) => void;
	/** 調査用のセッションを起動したとき (一覧に足して開く) */
	onSessionStarted: (session: CloudSession) => void;
}) => {
	const toast = useToast();
	const [headline, setHeadline] = useState('');
	const [items, setItems] = useState<Decision[]>([]);
	const [hidden, setHidden] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const [busyId, setBusyId] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const inbox = await listDecisions(auth);
			setHeadline(inbox.headline);
			setItems(inbox.decisions);
			setHidden(false);
		} catch (e) {
			// サーバーが未対応なら黙って出さない。通信エラーはホームの一覧側が知らせる。
			if (isInboxUnsupported(e)) setHidden(true);
		}
	}, [auth]);

	useEffect(() => { void load(); }, [load, refreshKey]);
	// 検出された摩擦 (CI 失敗など) はセッションと関係なく届くので、ゆっくり読み直す。
	useEffect(() => {
		const timer = setInterval(() => { void load(); }, SIGNAL_POLL_MS);
		return () => clearInterval(timer);
	}, [load]);

	const onOption = useCallback(async (decision: Decision, option: DecisionOption) => {
		if (option.id === 'open_url') {
			if (option.url) void Linking.openURL(option.url);
			return;
		}
		if ((option.id === 'open_session' || option.id === 'create_pr') && decision.sessionId) {
			onOpenSession(decision.sessionId);
			return;
		}
		setBusyId(decision.id);
		try {
			if (option.id === 'dismiss') {
				await dismissDecision(auth, decision.id);
				setItems(prev => prev.filter(d => d.id !== decision.id));
			} else if (option.id === 'investigate' && decision.investigation) {
				const inv = decision.investigation;
				const [result] = await launchSessions(auth, { prompt: inv.prompt, title: inv.title || decision.title, count: 1, repo: inv.repo });
				if (!result?.session || result.error) throw new Error(result?.error || '起動できませんでした');
				const updated = await markInvestigating(auth, decision.id, result.session.id).catch(() => null);
				setItems(prev => prev.map(d => (d.id === decision.id ? (updated ?? { ...d, status: 'in_progress', sessionId: result.session!.id }) : d)));
				toast.show('AI が調査を始めました', 'success');
				onSessionStarted(result.session);
			}
		} catch (e) {
			toast.show(cloudErrorText(e), 'error');
		} finally {
			setBusyId(null);
		}
	}, [auth, onOpenSession, onSessionStarted, toast]);

	if (hidden || items.length === 0) return null;
	const visible = expanded ? items : items.slice(0, COLLAPSED);
	const open = openCount(items);

	return (
		<View style={styles.root} accessibilityLabel={`判断が必要な項目 ${open} 件`}>
			<View style={styles.header}>
				<Icon name='inbox' size={16} color={colors.fg} />
				<Text style={styles.headerTitle}>判断が必要</Text>
				{open ? <View style={styles.count}><Text style={styles.countText}>{open}</Text></View> : null}
			</View>
			{headline ? <Muted style={styles.headline}>{headline}</Muted> : null}
			{visible.map(d => (
				<DecisionCard key={d.id} decision={d} busy={busyId === d.id} onOption={o => void onOption(d, o)} />
			))}
			{items.length > COLLAPSED ? (
				<Pressable accessibilityRole='button' onPress={() => setExpanded(v => !v)} style={styles.more}>
					<Text style={styles.moreText}>{expanded ? '閉じる' : `ほか ${items.length - COLLAPSED} 件を表示`}</Text>
				</Pressable>
			) : null}
		</View>
	);
};

const styles = StyleSheet.create({
	root: { gap: spacing.sm, marginBottom: spacing.lg },
	header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
	headerTitle: { color: colors.fgStrong, fontSize: fontSize.sm, fontWeight: '600' },
	count: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.danger },
	countText: { color: colors.bg, fontSize: 11, fontWeight: '700' },
	headline: { lineHeight: 18 },
	card: {
		gap: spacing.xs,
		padding: spacing.md,
		borderRadius: radius.lg,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.borderStrong,
		backgroundColor: colors.bgElevated,
	},
	cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
	kind: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
	kindText: { fontSize: 11, fontWeight: '600' },
	cardTitle: { flex: 1, color: colors.fgStrong, fontSize: fontSize.sm, fontWeight: '600' },
	cardText: { lineHeight: 18 },
	evidence: { gap: 2 },
	evidenceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 22 },
	evidenceText: { flex: 1, color: colors.fgMuted, fontSize: fontSize.xs },
	riskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
	riskText: { flex: 1, color: colors.warning, fontSize: fontSize.xs, lineHeight: 17 },
	recommendation: { color: colors.fg, fontSize: fontSize.xs, lineHeight: 17 },
	actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
	primary: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.fgStrong },
	primaryText: { color: colors.bg, fontSize: fontSize.xs + 1, fontWeight: '600' },
	secondary: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong },
	secondaryText: { color: colors.fg, fontSize: fontSize.xs + 1 },
	pressed: { opacity: 0.6 },
	more: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
	moreText: { color: colors.accentText, fontSize: fontSize.xs },
});
