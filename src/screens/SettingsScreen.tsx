/**
 * 接続とワークスペースのタブ。
 *
 * 接続先の切り替え / 解除に加えて、ワークスペースのファイルを辿って
 * IDE 側で開かせることができる (「あのファイル開いといて」を手元から)。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { OrchestraApiError } from '../api/client';
import { FileEntry, PROTOCOL_VERSION } from '../api/types';
import {
	Badge,
	Body,
	Button,
	Card,
	Divider,
	ErrorBanner,
	Loading,
	Muted,
	Row,
	Screen,
	ScreenHeader,
	SectionTitle,
} from '../components/ui';
import { relativeTime } from '../lib/format';
import { useApp } from '../state/AppContext';
import { colors, fontSize, spacing } from '../theme';

export const SettingsScreen = () => {
	const { snapshot, connection, connections, connect, disconnect, forget, error, refresh, isRefreshing, client } = useApp();

	const [relPath, setRelPath] = useState('');
	const [entries, setEntries] = useState<FileEntry[]>([]);
	const [notice, setNotice] = useState<string | null>(null);
	const [loadingFiles, setLoadingFiles] = useState(false);

	const loadDir = useCallback(async (next: string) => {
		if (!client) return;
		setLoadingFiles(true);
		setNotice(null);
		try {
			const res = await client.listFiles(next);
			setEntries(res.children);
			setRelPath(next);
		} catch (e) {
			setNotice(e instanceof OrchestraApiError ? e.userMessage : String(e));
		} finally {
			setLoadingFiles(false);
		}
	}, [client]);

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

	return (
		<Screen>
			<ScreenHeader title='接続とワークスペース' subtitle='デバイスとファイルを手元から管理' />
			{error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}

			<ScrollView
				contentContainerStyle={styles.content}
				refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />}
			>
				<Card>
					<SectionTitle right={<Badge label='接続中' color={colors.success} />}>接続先</SectionTitle>
					<Body>{connection.label}</Body>
					<Muted>{connection.url}</Muted>
					<Divider />
					<Muted>{snapshot.ide.appName} {snapshot.ide.version}</Muted>
					<Muted>ワークスペース: {snapshot.ide.workspaceName || '(未オープン)'}</Muted>
					<Muted>最終更新: {relativeTime(snapshot.generatedAt)} · rev {snapshot.revision}</Muted>
					{snapshot.ide.protocolVersion !== PROTOCOL_VERSION ? (
						<Text style={styles.warnText}>
							プロトコルが違います (IDE v{snapshot.ide.protocolVersion} / アプリ v{PROTOCOL_VERSION})。どちらかを更新してください。
						</Text>
					) : null}
					<Button title='接続を解除' variant='secondary' onPress={() => void disconnect()} />
				</Card>

				<Card>
					<SectionTitle>ワークスペースのファイル</SectionTitle>
					<Muted numberOfLines={1}>/{relPath || ''}</Muted>
					{loadingFiles ? <Loading /> : null}
					{relPath ? (
						<Pressable accessibilityRole='button' onPress={() => void loadDir(parentPath)} style={styles.fileRow}>
							<Text style={styles.fileIcon}>↩</Text>
							<Body>..</Body>
						</Pressable>
					) : null}
					{entries.map(entry => (
						<Pressable
							key={entry.path}
							accessibilityRole='button'
							style={styles.fileRow}
							onPress={() => {
								if (entry.isDirectory) {
									void loadDir(relPath ? `${relPath}/${entry.name}` : entry.name);
									return;
								}
								void (async () => {
									try {
										await client?.openFile(relPath ? `${relPath}/${entry.name}` : entry.name);
										setNotice(`${entry.name} を IDE で開きました`);
									} catch (e) {
										setNotice(e instanceof OrchestraApiError ? e.userMessage : String(e));
									}
								})();
							}}
						>
							<Text style={styles.fileIcon}>{entry.isDirectory ? '📁' : '📄'}</Text>
							<Body numberOfLines={1}>{entry.name}</Body>
						</Pressable>
					))}
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
									<Button title='切替' variant='secondary' onPress={() => void connect(c)} />
									<Button title='削除' variant='ghost' onPress={() => void forget(c.url)} />
								</Row>
							</View>
						))}
					</Card>
				) : null}

				<Card>
					<SectionTitle>このアプリについて</SectionTitle>
					<Muted>Orchestra Mobile — Orchestra IDE のリモートコントローラー</Muted>
					<Muted>プロトコル v{PROTOCOL_VERSION}</Muted>
					<Muted>通信は同一 LAN 内の IDE と直接やり取りします。外部サーバーは経由しません。</Muted>
				</Card>

				{notice ? <Text style={styles.notice}>{notice}</Text> : null}
			</ScrollView>
		</Screen>
	);
};

const styles = StyleSheet.create({
	flex: { flex: 1 },
	content: {
		padding: spacing.lg,
		gap: spacing.lg,
		paddingBottom: spacing.xl,
	},
	fileRow: {
		minHeight: 48,
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		paddingVertical: spacing.xs + 2,
	},
	fileIcon: {
		fontSize: fontSize.sm,
	},
	savedRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		paddingVertical: spacing.xs,
	},
	notice: {
		color: colors.fgMuted,
		fontSize: fontSize.xs,
		textAlign: 'center',
	},
	warnText: {
		color: colors.warning,
		fontSize: fontSize.xs,
	},
});

