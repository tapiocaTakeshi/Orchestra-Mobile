/**
 * クラウドエージェントの「プロジェクト」選び。新しいセッションのシートとカンバンの「クラウドで実行」で使う。
 *
 * 一覧は PC に接続していれば PC の Orchestra のプロジェクト (有効なものが先頭)、その後ろに
 * Division API の自分のプロジェクト (新しく更新した順) のうち PC に無いものを並べる。
 * プロジェクトを選ぶと、エージェントはそのプロジェクトの「コーダー」のモデルで動く。
 * クラウドのシートでモデルに Division Project を選んだときは、そのプロジェクトに固定する (lockedReason)。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ErrorBanner, Icon, Muted } from './ui';
import { DivisionSession } from '../lib/divisionAuth';
import {
	CloudProjectOption,
	CloudProjectSource,
	listServerProjects,
	mergeProjectOptions,
	projectOptionsFromPc,
} from '../lib/divisionProjects';
import { useApp } from '../state/AppContext';
import { colors, fontSize, radius, spacing } from '../theme';

export type CloudProjects = {
	projects: CloudProjectOption[];
	source: CloudProjectSource;
	loading: boolean;
	error: string | null;
	reload: () => void;
};

/**
 * プロジェクトの一覧。PC の一覧 (接続中) と Division API の一覧を合わせる。
 * PC や Web で作ったばかりのものも出るよう、reload で Division API を読み直す。
 */
export const useCloudProjects = (auth: DivisionSession | null): CloudProjects => {
	const { connection, snapshot } = useApp();
	const pcProjects = snapshot?.division?.projects;
	const pcOptions = useMemo(
		() => (connection && pcProjects ? projectOptionsFromPc(pcProjects) : []),
		[connection, pcProjects],
	);
	// 接続中でもスナップショットが届く前は「読み込み中」にしておく
	const waitingForPc = !!connection && !snapshot;

	const [serverProjects, setServerProjects] = useState<CloudProjectOption[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [nonce, setNonce] = useState(0);

	// auth はトークン更新で別オブジェクトになるので、最新のものを ref で読む
	const authRef = useRef(auth);
	authRef.current = auth;
	const userId = auth?.userId;
	useEffect(() => {
		const current = authRef.current;
		if (!current) { setServerProjects([]); return; }
		let cancelled = false;
		setLoading(true);
		setError(null);
		void listServerProjects(current)
			.then(rows => { if (!cancelled) setServerProjects(rows); })
			.catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
			.finally(() => { if (!cancelled) setLoading(false); });
		return () => { cancelled = true; };
	}, [userId, nonce]);

	const reload = useCallback(() => setNonce(n => n + 1), []);

	const projects = useMemo(() => mergeProjectOptions(pcOptions, serverProjects), [pcOptions, serverProjects]);
	return {
		projects,
		source: pcOptions.length > 0 ? 'pc' : 'division',
		loading: waitingForPc || (loading && projects.length === 0),
		// PC の一覧が出ていれば、Division API が失敗してもそれで選べるので警告は出さない
		error: pcOptions.length > 0 ? null : error,
		reload,
	};
};

/** 一度に並べる数。多いときは「すべて表示」で広げる。 */
const COLLAPSED_COUNT = 8;

export const CloudProjectPicker = ({ projects, value, onChange, lockedReason, hint }: {
	projects: CloudProjects;
	/** 選んだプロジェクトの ID (空なら指定なし) */
	value: string;
	onChange: (projectId: string) => void;
	/** 指定すると選べなくなり、この理由を出す (モデルに Division Project を選んでいるときなど) */
	lockedReason?: string;
	/** プロジェクトを選んでいるときの説明を差し替える */
	hint?: string;
}) => {
	const locked = !!lockedReason;
	const [expanded, setExpanded] = useState(false);
	const list = projects.projects;
	// 選んでいるものが畳んだ範囲の外にあっても見えるようにする
	const selectedIndex = list.findIndex(p => p.id === value);
	const shown = expanded || list.length <= COLLAPSED_COUNT
		? list
		: list.filter((p, i) => i < COLLAPSED_COUNT || i === selectedIndex);
	const hidden = list.length - shown.length;

	const chip = (id: string, label: string, active?: boolean) => {
		const selected = id === value;
		return (
			<Pressable
				key={id || '__none'}
				accessibilityRole='button'
				accessibilityState={{ selected, disabled: locked }}
				accessibilityLabel={id ? `プロジェクト ${label}${active ? '、PC で有効' : ''}` : 'プロジェクトを指定しない'}
				disabled={locked}
				onPress={() => onChange(id)}
				style={[styles.chip, selected && styles.chipSelected, locked && !selected && styles.chipLocked]}
			>
				{selected ? <Icon name={locked ? 'lock' : 'check'} size={13} color={colors.fg} /> : null}
				<Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>{label}</Text>
				{active ? <View style={styles.activeDot} /> : null}
			</Pressable>
		);
	};

	return (
		<View style={styles.wrap}>
			<View style={styles.chips}>
				{chip('', '指定なし')}
				{shown.map(p => chip(p.id, p.name, p.active))}
				{hidden > 0 ? (
					<Pressable accessibilityRole='button' onPress={() => setExpanded(true)} style={styles.more}>
						<Text style={styles.moreText}>すべて表示 (+{hidden})</Text>
					</Pressable>
				) : null}
			</View>
			{/* 固定しているときは読み込み中・エラーの表示はモデルの欄に任せる (同じ一覧なので二重に出さない) */}
			{projects.loading && !locked ? (
				<View style={styles.loadingRow}>
					<ActivityIndicator size='small' color={colors.fgMuted} />
					<Muted>プロジェクトを読み込んでいます…</Muted>
				</View>
			) : null}
			{projects.error && !locked ? (
				<ErrorBanner tone='warning' message={projects.error} onRetry={projects.reload} style={styles.banner} />
			) : null}
			{!locked && !projects.loading && !projects.error && list.length === 0 ? (
				<Muted>Division のプロジェクトがまだありません。PC の Orchestra で作って保存すると選べます。</Muted>
			) : null}
			<Muted>
				{lockedReason
					? lockedReason
					: value
						? hint ?? '選んだプロジェクトの「コーダー」に割り当てたモデルで動きます (詳細でモデルを指定するとそちらが優先)。'
						: projects.source === 'pc'
							? 'PC の Orchestra のプロジェクトから選べます (緑の点は PC で有効なもの)。'
							: 'Division に保存したプロジェクトから選べます。'}
			</Muted>
		</View>
	);
};

const styles = StyleSheet.create({
	wrap: { gap: spacing.sm },
	chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
	chip: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
		maxWidth: '100%',
		minHeight: 36,
		paddingHorizontal: spacing.md,
		borderRadius: 999,
		borderWidth: 1,
		borderColor: colors.border,
	},
	chipSelected: { borderColor: colors.borderStrong, backgroundColor: colors.bgHover },
	chipLocked: { opacity: 0.45 },
	chipText: { color: colors.fgMuted, fontSize: fontSize.xs + 1, fontWeight: '600', flexShrink: 1 },
	chipTextSelected: { color: colors.fg },
	activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
	more: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.sm },
	moreText: { color: colors.accentText, fontSize: fontSize.xs + 1, fontWeight: '600' },
	loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
	banner: { marginHorizontal: 0 },
});
