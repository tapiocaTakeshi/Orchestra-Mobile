/**
 * クラウドエージェントの「モデル」選び。新しいセッションのシートで使う。
 *
 * デスクトップの IDE のモデルの選択と同じく、先頭に "Division Project · <プロジェクト名>" を並べる。
 * Division Project を選ぶと、そのプロジェクトのリーダーが役割ごとにタスクを分け、各役割に割り当てたモデルが
 * サンドボックスで順に進める (model: 'division-project' + projectId)。続けて「既定 (プロジェクトの coder ロール)」と、
 * provider/model を直接入力する「モデルを直接指定」。プロジェクトの一覧は CloudProjectPicker の useCloudProjects と同じもの。
 */

import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { CloudProjects } from './CloudProjectPicker';
import { ErrorBanner, Icon, IconName, Input, Muted } from './ui';
import {
	CloudModelMode,
	CloudModelOption,
	CloudModelSelection,
	applyModelOption,
	cloudModelOptions,
	modelOptionKey,
} from '../lib/divisionCloud';
import { colors, fontSize, radius, spacing } from '../theme';

/** Division Project を一度に並べる数。多いときは「すべて表示」で広げる。 */
const COLLAPSED_PROJECTS = 5;

const MODE_ICONS: Record<CloudModelMode, IconName> = { division: 'users', default: 'cpu', custom: 'edit-3' };

export const CloudModelPicker = ({ projects, value, onChange }: {
	projects: CloudProjects;
	value: CloudModelSelection;
	onChange: (next: CloudModelSelection) => void;
}) => {
	const [expanded, setExpanded] = useState(false);
	const options = cloudModelOptions(projects.projects, value.mode === 'division' ? value.projectId : undefined);
	const selectedKey = modelOptionKey(value);
	const division = options.filter(o => o.mode === 'division');
	const rest = options.filter(o => o.mode !== 'division');
	// 選んでいるものが畳んだ範囲の外にあっても見えるようにする
	const shownDivision = expanded || division.length <= COLLAPSED_PROJECTS
		? division
		: division.filter((o, i) => i < COLLAPSED_PROJECTS || o.key === selectedKey);
	const hidden = division.length - shownDivision.length;

	const row = (option: CloudModelOption) => {
		const selected = option.key === selectedKey;
		return (
			<Pressable
				key={option.key}
				accessibilityRole='radio'
				accessibilityState={{ selected }}
				accessibilityLabel={`モデル ${option.label}${option.active ? '、PC で有効' : ''}`}
				onPress={() => onChange(applyModelOption(value, option))}
				style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.rowPressed]}
			>
				<Icon name={MODE_ICONS[option.mode]} size={16} color={selected ? colors.fg : colors.fgMuted} />
				<View style={styles.flex}>
					<View style={styles.labelLine}>
						<Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>{option.label}</Text>
						{option.active ? <View style={styles.activeDot} /> : null}
					</View>
					{option.detail ? <Text style={styles.detail} numberOfLines={2}>{option.detail}</Text> : null}
				</View>
				{selected ? <Icon name='check' size={16} color={colors.fg} /> : null}
			</Pressable>
		);
	};

	return (
		<View style={styles.wrap}>
			<View style={styles.list}>
				{shownDivision.map(row)}
				{hidden > 0 ? (
					<Pressable accessibilityRole='button' onPress={() => setExpanded(true)} style={styles.more}>
						<Text style={styles.moreText}>Division Project をすべて表示 (+{hidden})</Text>
					</Pressable>
				) : null}
				{projects.loading ? (
					<View style={styles.loadingRow}>
						<ActivityIndicator size='small' color={colors.fgMuted} />
						<Muted>Division のプロジェクトを読み込んでいます…</Muted>
					</View>
				) : null}
				{rest.map(row)}
			</View>
			{projects.error ? (
				<ErrorBanner tone='warning' message={projects.error} onRetry={projects.reload} style={styles.banner} />
			) : null}
			{!projects.loading && !projects.error && projects.projects.length === 0 ? (
				<Muted>Division のプロジェクトが無いため、Division Project は選べません。PC の Orchestra で作って保存すると並びます。</Muted>
			) : null}
			{value.mode === 'custom' ? (
				<Input
					value={value.model}
					onChangeText={model => onChange({ ...value, model })}
					placeholder='provider/model (空欄なら既定と同じ)'
					autoCapitalize='none'
					autoCorrect={false}
					accessibilityLabel='モデル'
				/>
			) : null}
		</View>
	);
};

const styles = StyleSheet.create({
	flex: { flex: 1 },
	wrap: { gap: spacing.sm },
	list: { gap: spacing.xs },
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		minHeight: 48,
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
	},
	rowSelected: { borderColor: colors.borderStrong, backgroundColor: colors.bgHover },
	rowPressed: { opacity: 0.6 },
	labelLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
	label: { color: colors.fgMuted, fontSize: fontSize.xs + 1, fontWeight: '600', flexShrink: 1 },
	labelSelected: { color: colors.fg },
	detail: { color: colors.fgFaint, fontSize: fontSize.xs, marginTop: 2 },
	activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
	more: { minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing.sm, alignSelf: 'flex-start' },
	moreText: { color: colors.accentText, fontSize: fontSize.xs + 1, fontWeight: '600' },
	loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 36 },
	banner: { marginHorizontal: 0 },
});
