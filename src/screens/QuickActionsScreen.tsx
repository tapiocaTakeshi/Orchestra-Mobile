/**
 * よく使うエディタ操作 (保存・ウィンドウ再読み込みなど) をワンタップで実行するページ。
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { OrchestraApiError } from '../api/client';
import { Icon, IconName, Screen, ScreenHeader, useToast } from '../components/ui';
import { useApp } from '../state/AppContext';
import { colors, fontSize, radius, spacing } from '../theme';

/** allowCommands がオフでも通るものを先に置く。 */
const QUICK_COMMANDS: { id: string; label: string; sub: string; icon: IconName }[] = [
	{ id: 'workbench.action.files.saveAll', label: 'すべて保存', sub: '開いているファイルを保存', icon: 'save' },
	{ id: 'void.kanban.runNext', label: 'カンバンの次のタスクを実行', sub: '未着手の先頭をエージェントへ', icon: 'play' },
	{ id: 'void.kanban.toggleAutoRun', label: 'カンバン自動実行の切替', sub: '自動で次々に実行する', icon: 'repeat' },
	{ id: 'workbench.action.terminal.new', label: 'ターミナルを開く', sub: 'PC に新しいターミナル', icon: 'terminal' },
	{ id: 'workbench.action.reloadWindow', label: 'ウィンドウを再読み込み', sub: 'エディタを再起動せずに更新', icon: 'refresh-cw' },
];

export const QuickActionsScreen = () => {
	const { client, invalidate } = useApp();
	const toast = useToast();

	const run = async (id: string, label: string) => {
		if (!client) return;
		try {
			await client.runCommand(id);
			toast.show(`${label} を実行しました`, 'success');
			invalidate();
		} catch (e) {
			toast.show(e instanceof OrchestraApiError ? e.userMessage : String(e), 'error');
		}
	};

	return (
		<Screen>
			<ScreenHeader title='クイックアクション' />
			<ScrollView contentContainerStyle={styles.content}>
				<Text style={styles.intro}>よく使う操作をワンタップで PC のエディタに送ります。</Text>
				<View style={styles.grid}>
					{QUICK_COMMANDS.map(cmd => (
						<Pressable
							key={cmd.id}
							accessibilityRole='button'
							accessibilityLabel={cmd.label}
							onPress={() => void run(cmd.id, cmd.label)}
							style={({ pressed }) => [styles.card, pressed && styles.rowPressed]}
						>
							<View style={styles.iconTile}><Icon name={cmd.icon} size={18} color={colors.accentText} /></View>
							<Text style={styles.label}>{cmd.label}</Text>
							<Text style={styles.sub}>{cmd.sub}</Text>
						</Pressable>
					))}
				</View>
			</ScrollView>
		</Screen>
	);
};

const styles = StyleSheet.create({
	content: { padding: spacing.lg, gap: spacing.md },
	intro: { color: colors.fgMuted, fontSize: fontSize.sm, lineHeight: 20 },
	grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
	card: {
		flexBasis: '47%',
		flexGrow: 1,
		gap: spacing.xs,
		padding: spacing.md,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.bgElevated,
	},
	iconTile: { width: 32, height: 32, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgSidebar, marginBottom: spacing.xs },
	rowPressed: { opacity: 0.6 },
	label: { color: colors.fgStrong, fontSize: fontSize.sm, fontWeight: '600' },
	sub: { color: colors.fgMuted, fontSize: fontSize.xs },
});
