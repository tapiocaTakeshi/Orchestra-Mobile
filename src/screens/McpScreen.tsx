/**
 * MCP のページ。
 *
 * MCP ストアからワンタップで (必要ならトークンを入れて) MCP サーバーを追加したり、URL を指定して
 * 自分の MCP サーバーを足したりする。有効にしたサーバーのツールはクラウドエージェントが使える。
 * 設定は Division のアカウントに保存されるので、PC との接続がなくても開ける。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
	KeyboardAvoidingView,
	Linking,
	Platform,
	RefreshControl,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native';

import {
	Badge,
	Body,
	Button,
	Card,
	EmptyState,
	ErrorBanner,
	Input,
	Loading,
	Muted,
	Row,
	Screen,
	ScreenHeader,
	SectionTitle,
	SegmentedControl,
	Sheet,
	Toggle,
	confirmAction,
	useToast,
} from '../components/ui';
import {
	McpCatalogEntry,
	McpServer,
	McpTestResult,
	addCustomMcpServer,
	customServerIssue,
	deleteMcpServer,
	getMcpCatalog,
	groupCatalog,
	installMcpFromCatalog,
	listMcpServers,
	mcpErrorText,
	needsToken,
	testMcpServer,
	updateMcpServer,
} from '../lib/divisionMcp';
import { useDivisionAuth } from '../state/DivisionAuthContext';
import { colors, fontSize, spacing } from '../theme';

type Tab = 'store' | 'installed';

const authBadge = (entry: McpCatalogEntry): { label: string; color: string } => {
	if (entry.auth.type === 'none') return { label: 'トークン不要', color: colors.success };
	if (entry.auth.optional) return { label: 'トークン任意', color: colors.fgFaint };
	return { label: 'トークンが必要', color: colors.warning };
};

const openUrl = (url: string | undefined) => {
	if (url) void Linking.openURL(url).catch(() => undefined);
};

/** ストアのサーバーを追加する (または登録済みのトークンを入れ直す) シート。 */
const TokenSheet = ({ entry, mode, busy, onSubmit, onClose }: {
	entry: McpCatalogEntry;
	mode: 'install' | 'update';
	busy: boolean;
	onSubmit: (token: string) => void;
	onClose: () => void;
}) => {
	const [token, setToken] = useState('');
	const required = needsToken(entry) || mode === 'update';
	return (
		<Sheet
			title={mode === 'install' ? `${entry.name} を追加` : 'トークンを更新'}
			eyebrow={mode === 'install' ? 'MCP ストア' : entry.name}
			onClose={onClose}
			headerRight={(
				<Button
					title={mode === 'install' ? '追加' : '保存'}
					size='sm'
					loading={busy}
					disabled={required && !token.trim()}
					onPress={() => onSubmit(token)}
				/>
			)}
		>
			<KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
				<ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps='handled'>
					<Body>{entry.description}</Body>
					<Muted>{entry.url}</Muted>
					<SectionTitle>{entry.auth.label || 'トークン'}{entry.auth.optional && mode === 'install' ? ' (任意)' : ''}</SectionTitle>
					<Input
						value={token}
						onChangeText={setToken}
						placeholder={entry.auth.placeholder || 'トークン'}
						autoCapitalize='none'
						autoCorrect={false}
						secureTextEntry
						accessibilityLabel={entry.auth.label || 'トークン'}
					/>
					<Muted>
						トークンは Division のサーバーに暗号化して保存され、この端末には残りません。
						{entry.auth.type === 'header' && entry.auth.header ? ` ${entry.auth.header} ヘッダーで送ります。` : ''}
					</Muted>
					{entry.auth.docsUrl ? (
						<Button title='トークンを発行する' variant='secondary' size='sm' icon='external-link' onPress={() => openUrl(entry.auth.docsUrl)} />
					) : null}
				</ScrollView>
			</KeyboardAvoidingView>
		</Sheet>
	);
};

/** URL を指定して MCP サーバーを足すシート。 */
const CustomSheet = ({ busy, onSubmit, onClose }: {
	busy: boolean;
	onSubmit: (input: { name: string; url: string; headerName: string; headerValue: string }) => void;
	onClose: () => void;
}) => {
	const [name, setName] = useState('');
	const [url, setUrl] = useState('https://');
	const [headerName, setHeaderName] = useState('Authorization');
	const [headerValue, setHeaderValue] = useState('');
	const input = { name, url, headerName: headerValue.trim() ? headerName : '', headerValue };
	const issue = customServerIssue(input);
	return (
		<Sheet
			title='カスタム MCP サーバー'
			eyebrow='MCP'
			onClose={onClose}
			headerRight={<Button title='追加' size='sm' loading={busy} disabled={!!issue} onPress={() => onSubmit(input)} />}
		>
			<KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
				<ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps='handled'>
					<SectionTitle>名前</SectionTitle>
					<Input value={name} onChangeText={setName} placeholder='例: 社内ツール' maxLength={60} />
					<SectionTitle>URL (Streamable HTTP)</SectionTitle>
					<Input value={url} onChangeText={setUrl} placeholder='https://example.com/mcp' autoCapitalize='none' autoCorrect={false} keyboardType='url' />
					<SectionTitle>認証ヘッダー (任意)</SectionTitle>
					<Input value={headerName} onChangeText={setHeaderName} placeholder='Authorization' autoCapitalize='none' autoCorrect={false} />
					<Input value={headerValue} onChangeText={setHeaderValue} placeholder='Bearer ...' autoCapitalize='none' autoCorrect={false} secureTextEntry />
					{issue && name ? <Muted style={styles.issue}>{issue}</Muted> : null}
					<Muted>リモートの MCP サーバー (https) に対応しています。OAuth でしかログインできないサーバーは使えません。</Muted>
				</ScrollView>
			</KeyboardAvoidingView>
		</Sheet>
	);
};

const ServerCard = ({ server, entry, busy, test, onToggle, onTest, onUpdateToken, onDelete }: {
	server: McpServer;
	entry: McpCatalogEntry | undefined;
	busy: boolean;
	test: McpTestResult | 'running' | undefined;
	onToggle: (enabled: boolean) => void;
	onTest: () => void;
	onUpdateToken: (() => void) | undefined;
	onDelete: () => void;
}) => (
	<Card style={styles.card}>
		<Row style={styles.cardHeader}>
			<View style={styles.flex}>
				<Text style={styles.cardTitle} numberOfLines={1}>{server.name}</Text>
				<Muted numberOfLines={1}>{server.url}</Muted>
			</View>
			<Toggle value={server.enabled} disabled={busy} onValueChange={onToggle} accessibilityLabel={`${server.name} を有効にする`} />
		</Row>
		<Row style={styles.badges}>
			<Badge label={entry ? 'ストア' : 'カスタム'} icon={entry ? 'shopping-bag' : 'link'} />
			{server.headerNames.length ? <Badge label='トークン設定済み' icon='lock' color={colors.success} /> : null}
			{!server.enabled ? <Badge label='無効' color={colors.fgFaint} /> : null}
		</Row>
		{test === 'running' ? <Muted>接続を確かめています…</Muted> : null}
		{test && test !== 'running' && test.ok ? (
			<View style={styles.testResult}>
				<Badge label={`接続 OK · ツール ${test.tools.length} 個`} icon='check-circle' color={colors.success} />
				<Muted numberOfLines={4}>{test.tools.map(t => t.name).join(', ') || 'ツールがありません'}</Muted>
			</View>
		) : null}
		{test && test !== 'running' && !test.ok ? <ErrorBanner message={test.error} /> : null}
		<Row style={styles.actions}>
			<Button title='接続テスト' size='sm' variant='secondary' icon='activity' disabled={test === 'running'} onPress={onTest} />
			{onUpdateToken ? <Button title='トークン' size='sm' variant='secondary' icon='key' onPress={onUpdateToken} /> : null}
			<Button title='削除' size='sm' variant='ghost' icon='trash-2' disabled={busy} onPress={onDelete} />
		</Row>
	</Card>
);

export const McpScreen = () => {
	const { session } = useDivisionAuth();
	const toast = useToast();

	const [tab, setTab] = useState<Tab>('store');
	const [catalog, setCatalog] = useState<McpCatalogEntry[] | null>(null);
	const [servers, setServers] = useState<McpServer[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [tests, setTests] = useState<Record<string, McpTestResult | 'running'>>({});
	const [tokenSheet, setTokenSheet] = useState<{ entry: McpCatalogEntry; server?: McpServer } | null>(null);
	const [customOpen, setCustomOpen] = useState(false);

	const load = useCallback(async () => {
		if (!session) return;
		try {
			const [nextCatalog, nextServers] = await Promise.all([getMcpCatalog(session), listMcpServers(session)]);
			setCatalog(nextCatalog);
			setServers(nextServers);
			setError(null);
		} catch (e) {
			setError(mcpErrorText(e));
		}
	}, [session]);

	useEffect(() => {
		void load();
	}, [load]);

	const onRefresh = useCallback(async () => {
		setRefreshing(true);
		await load();
		setRefreshing(false);
	}, [load]);

	const entryById = useMemo(() => new Map((catalog ?? []).map(e => [e.id, e])), [catalog]);
	const installedIds = useMemo(() => new Set((servers ?? []).map(s => s.catalogId).filter(Boolean)), [servers]);
	const groups = useMemo(() => groupCatalog(catalog ?? []), [catalog]);

	const runTest = useCallback(async (server: McpServer) => {
		if (!session) return;
		setTests(t => ({ ...t, [server.id]: 'running' }));
		try {
			const result = await testMcpServer(session, server.id);
			setTests(t => ({ ...t, [server.id]: result }));
		} catch (e) {
			setTests(t => ({ ...t, [server.id]: { ok: false, error: mcpErrorText(e) } }));
		}
	}, [session]);

	const added = useCallback((server: McpServer) => {
		setServers(list => [...(list ?? []).filter(s => s.id !== server.id), server]);
		toast.show(`${server.name} を追加しました`, 'success');
		setTab('installed');
		void runTest(server);
	}, [runTest, toast]);

	const install = useCallback(async (entry: McpCatalogEntry, token?: string) => {
		if (!session) return;
		setBusyId(entry.id);
		try {
			added(await installMcpFromCatalog(session, entry.id, token));
			setTokenSheet(null);
		} catch (e) {
			toast.show(mcpErrorText(e), 'error');
		} finally {
			setBusyId(null);
		}
	}, [added, session, toast]);

	const onStorePress = useCallback((entry: McpCatalogEntry) => {
		if (entry.auth.type === 'none') void install(entry);
		else setTokenSheet({ entry });
	}, [install]);

	const updateToken = useCallback(async (server: McpServer, token: string) => {
		if (!session) return;
		setBusyId(server.id);
		try {
			const updated = await updateMcpServer(session, server.id, { token });
			setServers(list => (list ?? []).map(s => (s.id === updated.id ? updated : s)));
			setTokenSheet(null);
			toast.show('トークンを更新しました', 'success');
			void runTest(updated);
		} catch (e) {
			toast.show(mcpErrorText(e), 'error');
		} finally {
			setBusyId(null);
		}
	}, [runTest, session, toast]);

	const addCustom = useCallback(async (input: { name: string; url: string; headerName: string; headerValue: string }) => {
		if (!session) return;
		setBusyId('custom');
		try {
			added(await addCustomMcpServer(session, input));
			setCustomOpen(false);
		} catch (e) {
			toast.show(mcpErrorText(e), 'error');
		} finally {
			setBusyId(null);
		}
	}, [added, session, toast]);

	const toggle = useCallback(async (server: McpServer, enabled: boolean) => {
		if (!session) return;
		setServers(list => (list ?? []).map(s => (s.id === server.id ? { ...s, enabled } : s)));
		try {
			await updateMcpServer(session, server.id, { enabled });
		} catch (e) {
			setServers(list => (list ?? []).map(s => (s.id === server.id ? { ...s, enabled: !enabled } : s)));
			toast.show(mcpErrorText(e), 'error');
		}
	}, [session, toast]);

	const remove = useCallback(async (server: McpServer) => {
		if (!session) return;
		const ok = await confirmAction({
			title: `${server.name} を削除しますか？`,
			message: '保存したトークンも削除されます。',
			confirmLabel: '削除',
			destructive: true,
		});
		if (!ok) return;
		setBusyId(server.id);
		try {
			await deleteMcpServer(session, server.id);
			setServers(list => (list ?? []).filter(s => s.id !== server.id));
		} catch (e) {
			toast.show(mcpErrorText(e), 'error');
		} finally {
			setBusyId(null);
		}
	}, [session, toast]);

	if (!session) {
		return (
			<Screen>
				<ScreenHeader title='MCP' />
				<EmptyState icon='package' title='Division にログインしてください' detail='MCP サーバーの設定は Division のアカウントに保存されます。' />
			</Screen>
		);
	}

	const installedCount = servers?.length ?? 0;

	return (
		<Screen>
			<ScreenHeader title='MCP' />
			<View style={styles.tabs}>
				<SegmentedControl
					options={[{ value: 'store', label: 'ストア' }, { value: 'installed', label: `インストール済み${installedCount ? ` (${installedCount})` : ''}` }]}
					value={tab}
					onChange={setTab}
				/>
			</View>
			{error ? <ErrorBanner message={error} onRetry={() => void load()} style={styles.banner} /> : null}
			{!catalog || !servers ? (
				error ? null : <Loading label='MCP の設定を読み込んでいます…' />
			) : (
				<ScrollView
					contentContainerStyle={styles.content}
					refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.fgMuted} />}
				>
					<Muted>有効にした MCP サーバーのツールは、クラウドエージェントが作業中に使えます。</Muted>
					{tab === 'store' ? (
						<>
							{groups.map(group => (
								<View key={group.category} style={styles.group}>
									<SectionTitle>{group.category}</SectionTitle>
									{group.entries.map(entry => {
										const badge = authBadge(entry);
										const installed = installedIds.has(entry.id);
										return (
											<Card key={entry.id} style={styles.card}>
												<Row style={styles.cardHeader}>
													<View style={styles.flex}>
														<Text style={styles.cardTitle}>{entry.name}</Text>
														<Muted>{entry.description}</Muted>
													</View>
													{installed
														? <Badge label='追加済み' icon='check' color={colors.success} />
														: <Button title='追加' size='sm' icon='plus' loading={busyId === entry.id} onPress={() => onStorePress(entry)} />}
												</Row>
												<Row style={styles.badges}>
													<Badge label={badge.label} color={badge.color} />
													{entry.homepage ? <Button title='詳細' size='sm' variant='ghost' icon='external-link' onPress={() => openUrl(entry.homepage)} /> : null}
												</Row>
											</Card>
										);
									})}
								</View>
							))}
							<View style={styles.group}>
								<SectionTitle>その他</SectionTitle>
								<Card style={styles.card}>
									<Text style={styles.cardTitle}>カスタム MCP サーバー</Text>
									<Muted>ストアにない MCP サーバーを URL で追加します。</Muted>
									<Row style={styles.actions}>
										<Button title='URL で追加' size='sm' variant='secondary' icon='link' onPress={() => setCustomOpen(true)} />
									</Row>
								</Card>
							</View>
						</>
					) : servers.length ? (
						servers.map(server => {
							const entry = server.catalogId ? entryById.get(server.catalogId) : undefined;
							return (
								<ServerCard
									key={server.id}
									server={server}
									entry={entry}
									busy={busyId === server.id}
									test={tests[server.id]}
									onToggle={enabled => void toggle(server, enabled)}
									onTest={() => void runTest(server)}
									onUpdateToken={entry && entry.auth.type !== 'none' ? () => setTokenSheet({ entry, server }) : undefined}
									onDelete={() => void remove(server)}
								/>
							);
						})
					) : (
						<EmptyState
							icon='package'
							title='MCP サーバーはまだありません'
							detail='ストアから追加すると、クラウドエージェントが GitHub やドキュメント検索などを使えるようになります。'
							action={<Button title='ストアを見る' size='sm' onPress={() => setTab('store')} />}
						/>
					)}
				</ScrollView>
			)}
			{tokenSheet ? (
				<TokenSheet
					entry={tokenSheet.entry}
					mode={tokenSheet.server ? 'update' : 'install'}
					busy={busyId === (tokenSheet.server?.id ?? tokenSheet.entry.id)}
					onSubmit={token => (tokenSheet.server ? void updateToken(tokenSheet.server, token) : void install(tokenSheet.entry, token))}
					onClose={() => setTokenSheet(null)}
				/>
			) : null}
			{customOpen ? <CustomSheet busy={busyId === 'custom'} onSubmit={input => void addCustom(input)} onClose={() => setCustomOpen(false)} /> : null}
		</Screen>
	);
};

const styles = StyleSheet.create({
	flex: { flex: 1 },
	tabs: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
	banner: { marginHorizontal: spacing.lg, marginTop: spacing.md },
	content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
	group: { gap: spacing.sm },
	card: { gap: spacing.sm },
	cardHeader: { alignItems: 'flex-start', gap: spacing.md },
	cardTitle: { color: colors.fgStrong, fontSize: fontSize.md, fontWeight: '600' },
	badges: { flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
	actions: { flexWrap: 'wrap', gap: spacing.sm },
	testResult: { gap: spacing.xs },
	sheetContent: { padding: spacing.lg, gap: spacing.md },
	issue: { color: colors.warning },
});
