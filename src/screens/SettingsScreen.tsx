/**
 * 接続とワークスペースのタブ。
 *
 * 接続先の切り替え / 解除に加えて、ワークスペースのファイルを辿って
 * IDE 側で開かせることができる (「あのファイル開いといて」を手元から)。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { OrchestraApiError } from '../api/client';
import { Connection, FileEntry, PROTOCOL_VERSION } from '../api/types';
import {
	Badge,
	Body,
	Button,
	Card,
	ErrorBanner,
	Icon,
	IconButton,
	Loading,
	Muted,
	Row,
	Screen,
	ScreenHeader,
	SectionTitle,
	confirmAction,
	useToast,
} from '../components/ui';
import { useApp } from '../state/AppContext';
import { useDivisionAuth } from '../state/DivisionAuthContext';
import { colors, fontSize, radius, spacing } from '../theme';

export const SettingsScreen = () => {
	const { snapshot, connection, connections, connect, disconnect, forget, error, refresh, isRefreshing, client } = useApp();
	const { session, logout } = useDivisionAuth();
	const toast = useToast();

	const [relPath, setRelPath] = useState('');
	const [entries, setEntries] = useState<FileEntry[]>([]);
	const [loadingFiles, setLoadingFiles] = useState(false);

	const loadDir = useCallback(async (next: string) => {
		if (!client) return;
		setLoadingFiles(true);
		try {
			const res = await client.listFiles(next);
			setEntries(res.children);
			setRelPath(next);
		} catch (e) {
			toast.show(e instanceof OrchestraApiError ? e.userMessage : String(e), 'error');
		} finally {
			setLoadingFiles(false);
		}
	}, [client, toast]);

	const openEntry = useCallback(async (entry: FileEntry) => {
		const path = relPath ? `${relPath}/${entry.name}` : entry.name;
		if (entry.isDirectory) {
			void loadDir(path);
			return;
		}
		try {
			await client?.openFile(path);
			toast.show(`${entry.name} を IDE で開きました`, 'success');
		} catch (e) {
			toast.show(e instanceof OrchestraApiError ? e.userMessage : String(e), 'error');
		}
	}, [client, loadDir, relPath, toast]);

	const onDisconnect = useCallback(async () => {
		const ok = await confirmAction({
			title: '接続を解除しますか？',
			message: '接続先は保存されたまま残るので、あとで選び直せます。',
			confirmLabel: '解除',
		});
		if (ok) await disconnect();
	}, [disconnect]);

	const onForget = useCallback(async (c: Connection) => {
		const ok = await confirmAction({
			title: '保存済みの接続を削除しますか？',
			message: `${c.label} (${c.url}) を一覧から削除します。`,
			confirmLabel: '削除',
			destructive: true,
		});
		if (ok) await forget(c.url);
	}, [forget]);

	const onLogout = useCallback(async () => {
		const ok = await confirmAction({
			title: 'ログアウトしますか？',
			message: 'この PC との接続も切れます。同じアカウントでログインし直すと、また繋がります。',
			confirmLabel: 'ログアウト',
			destructive: true,
		});
		if (ok) await logout();
	}, [logout]);

	useEffect(() => {
		if (client) void loadDir('');
	}, [client, loadDir]);

	if (!snapshot || !connection) {
		return (
			<Screen>
				{error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}
				<Loading label='接続情報を確認しています…' />
			</Screen>
		);
	}

	const parentPath = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
	// フォルダを先に、それぞれ名前順に並べる (ファイラーと同じ感覚で探せるように)。
	const sortedEntries = [...entries].sort((a, b) =>
		Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));

	return (
		<Screen>
			<ScreenHeader title='接続' />
			{error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}

			<ScrollView
				contentContainerStyle={styles.content}
				refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refresh()} tintColor={colors.fgMuted} />}
			>
				<Card>
					<SectionTitle right={<Badge label='接続中' color={colors.success} />}>接続先</SectionTitle>
					<Body>{connection.label}</Body>
					<Muted numberOfLines={1}>{connection.url} · {snapshot.ide.appName} {snapshot.ide.version}</Muted>
					{snapshot.ide.protocolVersion !== PROTOCOL_VERSION ? (
						<Text style={styles.warnText}>
							プロトコルが違います (IDE v{snapshot.ide.protocolVersion} / アプリ v{PROTOCOL_VERSION})。どちらかを更新してください。
						</Text>
					) : null}
					<Button title='接続を解除' variant='secondary' size='sm' onPress={() => void onDisconnect()} style={styles.start} />
				</Card>

				<Card>
					<SectionTitle right={loadingFiles ? <ActivityIndicator color={colors.fgMuted} size='small' /> : null}>
						ワークスペースのファイル
					</SectionTitle>
					<View style={styles.breadcrumb}>
						<Icon name='folder' size={14} color={colors.fgFaint} />
						<Text style={styles.breadcrumbText} numberOfLines={1} ellipsizeMode='head'>
							{snapshot.ide.workspaceName || 'workspace'}{relPath ? ` / ${relPath.split('/').join(' / ')}` : ''}
						</Text>
					</View>
					<View>
						{relPath ? (
							<Pressable
								accessibilityRole='button'
								accessibilityLabel='ひとつ上のフォルダへ'
								onPress={() => void loadDir(parentPath)}
								style={({ pressed }) => [styles.fileRow, pressed && styles.fileRowPressed]}
							>
								<Icon name='corner-left-up' size={18} color={colors.fgMuted} />
								<Body>ひとつ上へ</Body>
							</Pressable>
						) : null}
						{sortedEntries.map(entry => (
							<Pressable
								key={entry.path}
								accessibilityRole='button'
								accessibilityLabel={entry.isDirectory ? `フォルダ ${entry.name}` : `${entry.name} を IDE で開く`}
								style={({ pressed }) => [styles.fileRow, pressed && styles.fileRowPressed]}
								onPress={() => void openEntry(entry)}
							>
								<Icon name={entry.isDirectory ? 'folder' : 'file-text'} size={18} color={colors.fgMuted} />
								<View style={styles.flex}><Body numberOfLines={1}>{entry.name}</Body></View>
								<Icon name={entry.isDirectory ? 'chevron-right' : 'external-link'} size={16} color={colors.fgFaint} />
							</Pressable>
						))}
					</View>
					{!loadingFiles && entries.length === 0 ? <Muted>ファイルがありません。</Muted> : null}
				</Card>

				{connections.length > 1 ? (
					<Card>
						<SectionTitle>他の接続先</SectionTitle>
						{connections.filter(c => c.url !== connection.url).map(c => (
							<View key={c.url} style={styles.savedRow}>
								<View style={styles.flex}>
									<Body numberOfLines={1}>{c.label}</Body>
									<Muted numberOfLines={1}>{c.url}</Muted>
								</View>
								<Row>
									<Button title='切替' size='sm' variant='secondary' onPress={() => void connect(c)} />
									<IconButton icon='trash-2' accessibilityLabel={`${c.label} を削除`} onPress={() => void onForget(c)} />
								</Row>
							</View>
						))}
					</Card>
				) : null}

				{session ? (
					<Card>
						<Row>
							<View style={styles.flex}>
								<SectionTitle>アカウント</SectionTitle>
								<Muted numberOfLines={1}>{session.email}</Muted>
							</View>
							<Button title='ログアウト' variant='secondary' size='sm' onPress={() => void onLogout()} />
						</Row>
					</Card>
				) : null}

			</ScrollView>
		</Screen>
	);
};

const styles = StyleSheet.create({
	flex: { flex: 1 },
	start: { alignSelf: 'flex-start' },
	content: {
		paddingHorizontal: spacing.lg,
		paddingBottom: spacing.xl,
		gap: spacing.xs,
	},
	fileRow: {
		minHeight: 48,
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.md,
		paddingVertical: spacing.xs + 2,
		paddingHorizontal: spacing.xs,
		borderRadius: radius.sm,
	},
	fileRowPressed: { backgroundColor: colors.border },
	breadcrumb: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
		paddingHorizontal: spacing.sm,
		paddingVertical: spacing.xs + 2,
		borderRadius: radius.sm,
		backgroundColor: colors.bgInput,
	},
	breadcrumbText: { color: colors.fgMuted, fontSize: fontSize.xs, flex: 1 },
	savedRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		paddingVertical: spacing.xs,
	},
	warnText: {
		color: colors.warning,
		fontSize: fontSize.xs,
	},
});

