/**
 * よく使うエディタ操作 (保存・ウィンドウ再読み込みなど) をワンタップで実行するページ。
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { OrchestraApiError } from '../api/client';
import { Icon, IconName, Screen, ScreenHeader, useToast } from '../components/ui';
import { useApp } from '../state/AppContext';
import { colors, fontSize, spacing } from '../theme';

/** allowCommands がオフでも通るものを先に置く。 */
const QUICK_COMMANDS: { id: string; label: string; icon: IconName }[] = [
	{ id: 'workbench.action.files.saveAll', label: 'すべて保存', icon: 'save' },
	{ id: 'void.kanban.runNext', label: 'カンバンの次のタスクを実行', icon: 'play' },
	{ id: 'void.kanban.toggleAutoRun', label: 'カンバン自動実行の切替', icon: 'repeat' },
	{ id: 'workbench.action.terminal.new', label: 'ターミナルを開く', icon: 'terminal' },
	{ id: 'workbench.action.reloadWindow', label: 'ウィンドウを再読み込み', icon: 'refresh-cw' },
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
			<ScreenHeader title='クイック操作' />
			<ScrollView contentContainerStyle={styles.content}>
				{QUICK_COMMANDS.map(cmd => (
					<Pressable
						key={cmd.id}
						accessibilityRole='button'
						onPress={() => void run(cmd.id, cmd.label)}
						style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
					>
						<Icon name={cmd.icon} size={18} color={colors.fgMuted} />
						<Text style={styles.label}>{cmd.label}</Text>
					</Pressable>
				))}
			</ScrollView>
		</Screen>
	);
};

const styles = StyleSheet.create({
	content: { paddingHorizontal: spacing.lg },
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.md,
		minHeight: 56,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.border,
	},
	rowPressed: { opacity: 0.6 },
	label: { flex: 1, color: colors.fg, fontSize: fontSize.sm },
});
