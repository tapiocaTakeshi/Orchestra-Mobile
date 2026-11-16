/**
 * Division プロジェクト管理のタブ。
 *
 * PC に接続中はワークスペースの .division/projects.json をそのまま編集する。
 * 未接続のときは Division API のプロジェクト (クラウドエージェントが使う割り当て) を直接編集する。プロジェクトを
 * 有効にすると IDE 側の roleAssignments (どの役割をどのモデルに振るか) が
 * 切り替わるので、外出先から「今日はコーダーを Opus にする」といった調整ができる。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
	KeyboardAvoidingView,
	Platform,
	Pressable,
	RefreshControl,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native';

import { OrchestraApiError } from '../api/client';
import { DivisionProject, ProviderModels, RoleAssignment } from '../api/types';
import {
	Badge,
	Body,
	Button,
	Card,
	EmptyState,
	ErrorBanner,
	Icon,
	IconButton,
	Input,
	Loading,
	Muted,
	Row,
	Screen,
	ScreenHeader,
	SectionTitle,
	Sheet,
	StatusBadge,
	confirmAction,
	useToast,
} from '../components/ui';
import { KNOWN_ROLES, providerTitle, roleTitle } from '../lib/format';
import { publishAssignmentPost } from '../lib/divisionSocial';
import { defaultPostTitle, toPostAssignments } from '../lib/social';
import type { OpenPage } from '../navigation';
import { useApp } from '../state/AppContext';
import { useDivisionAuth } from '../state/DivisionAuthContext';
import { useServerProjects } from '../state/useServerProjects';
import { colors, fontSize, radius, spacing } from '../theme';

/** 役割ごとの編集行。モデル一覧はプロバイダーごとに畳んで出す。 */
const AgentRow = ({
	assignment,
	providers,
	disabled,
	onChange,
	onRemove,
}: {
	assignment: RoleAssignment;
	providers: ProviderModels[];
	disabled: boolean;
	onChange: (next: RoleAssignment) => void;
	onRemove: () => void;
}) => {
	const [open, setOpen] = useState(false);

	return (
		<View style={styles.agentRow}>
			<Pressable
				accessibilityRole='button'
				accessibilityState={{ expanded: open, disabled }}
				accessibilityLabel={`${roleTitle(assignment.role)}、${assignment.model || 'モデル未設定'}。モデルを変更`}
				disabled={disabled}
				onPress={() => setOpen(o => !o)}
				style={styles.agentHeader}
			>
				<View style={styles.flex}>
					<Body>{roleTitle(assignment.role)}</Body>
					<Muted>{providerTitle(assignment.provider)} · {assignment.model || '(未設定)'}</Muted>
				</View>
				<Text style={styles.link}>{open ? '閉じる' : 'モデルを変更'}</Text>
				<Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.accentText} />
				<IconButton
					icon='x'
					color={colors.fgFaint}
					accessibilityLabel={`${roleTitle(assignment.role)} の役割を外す`}
					disabled={disabled}
					onPress={onRemove}
				/>
			</Pressable>

			{open ? (
				<View style={styles.modelList}>
					{providers.length === 0 ? <Muted>選択できるモデルがありません。モデルの一覧を読み込めていないか、プロバイダーが設定されていません。</Muted> : null}
					{providers.map(p => (
						<View key={p.provider} style={styles.providerBlock}>
							<Muted>{providerTitle(p.provider)}</Muted>
							<View style={styles.modelChips}>
								{p.models.map(model => {
									const selected = assignment.provider === p.provider && assignment.model === model;
									return (
										<Pressable
											key={`${p.provider}:${model}`}
											accessibilityRole='button'
											accessibilityState={{ selected, disabled }}
											disabled={disabled}
											onPress={() => {
												// 推論の深さはモデルごとに使えるかが違うので、別のモデルにしたら外す
												onChange(selected ? assignment : { role: assignment.role, provider: p.provider, model });
												setOpen(false);
											}}
											style={[styles.modelChip, selected && styles.modelChipSelected]}
										>
											{selected ? <Icon name='check' size={14} color={colors.fg} /> : null}
										<Text style={[styles.modelChipText, selected && { color: colors.fg }]}>{model}</Text>
										</Pressable>
									);
								})}
							</View>
						</View>
					))}
				</View>
			) : null}
		</View>
	);
};

const ProjectEditor = ({
	project,
	providers,
	onClose,
	onSave,
	onDelete,
}: {
	project: DivisionProject;
	providers: ProviderModels[];
	onClose: () => void;
	onSave: (name: string, agents: RoleAssignment[]) => Promise<void>;
	onDelete: () => Promise<void>;
}) => {
	const [name, setName] = useState(project.name);
	const [agents, setAgents] = useState<RoleAssignment[]>(project.agents);
	const [customRole, setCustomRole] = useState('');
	const [saving, setSaving] = useState(false);

	// ポーリングで revision が進むたびに project は別オブジェクトになる。
	// それで入力中の内容を戻さないよう、別のプロジェクトを開いたときだけ読み直す。
	useEffect(() => {
		setName(project.name);
		setAgents(project.agents);
	}, [project.projectId]);

	const save = useCallback(async () => {
		if (saving) return;
		setSaving(true);
		try {
			await onSave(name, agents);
		} finally {
			setSaving(false);
		}
	}, [name, agents, onSave, saving]);

	const dirty = name !== project.name || JSON.stringify(agents) !== JSON.stringify(project.agents);

	/** 保存せずに閉じると編集が消えるので、変更があるときだけ確かめる。 */
	const close = useCallback(async () => {
		if (saving) return;
		if (dirty) {
			const ok = await confirmAction({
				title: '変更を破棄しますか？',
				message: '保存していない変更は失われます。',
				confirmLabel: '破棄して閉じる',
				destructive: true,
			});
			if (!ok) return;
		}
		onClose();
	}, [dirty, onClose, saving]);

	const remove = useCallback(async () => {
		if (saving) return;
		const ok = await confirmAction({
			title: 'プロジェクトを削除しますか？',
			message: `「${project.name}」と役割の割り当てを削除します。元に戻せません。`,
			confirmLabel: '削除',
			destructive: true,
		});
		if (ok) await onDelete();
	}, [project.name, onDelete, saving]);

	return (
		<Sheet
			title='プロジェクトを編集'
			eyebrow={project.name}
			onClose={() => void close()}
			headerRight={<Button title='保存' size='sm' loading={saving} disabled={!dirty || !name.trim()} onPress={() => void save()} />}
		>
			<KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
				<ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps='handled'>
					<Card>
						<SectionTitle>基本情報</SectionTitle>
						<Muted>プロジェクト名</Muted>
						<Input value={name} onChangeText={setName} placeholder='プロジェクト名' editable={!saving} />
						<Muted>プロジェクト ID</Muted>
						<Body>{project.projectId || '(未設定)'}</Body>
					</Card>

					<Card>
						<SectionTitle right={<Badge label={`${agents.length} 役割`} />}>役割ごとのモデル</SectionTitle>
						<Muted>ここで割り当てたモデルが、Division API のオーケストレーションで使われます。</Muted>
						{agents.length === 0 ? <Muted>役割が登録されていません。</Muted> : null}
						{agents.map((a, idx) => (
							<AgentRow
								key={`${a.role}-${idx}`}
								assignment={a}
								providers={providers}
								disabled={saving}
								onChange={next => setAgents(prev => prev.map((cur, i) => (i === idx ? next : cur)))}
								onRemove={() => setAgents(prev => prev.filter((_, i) => i !== idx))}
							/>
						))}
					</Card>

					<Card>
						<SectionTitle>役割を追加</SectionTitle>
						<Muted>まだ割り当てていない役割を足せます。モデルは追加したあとに選んでください。</Muted>
						<View style={styles.roleChips}>
							{KNOWN_ROLES.filter(role => !agents.some(a => a.role === role)).map(role => (
								<Pressable
									key={role}
									accessibilityRole='button'
									accessibilityLabel={`${roleTitle(role)} を追加`}
									accessibilityState={{ disabled: saving }}
									disabled={saving}
									onPress={() => setAgents(prev => [...prev, {
										role,
										provider: providers[0]?.provider ?? '',
										model: providers[0]?.models[0] ?? '',
									}])}
									style={styles.roleChip}
								>
									<Icon name='plus' size={14} color={colors.accentText} />
									<Text style={styles.roleChipText}>{roleTitle(role)}</Text>
								</Pressable>
							))}
						</View>
						<Row>
							<Input
								value={customRole}
								onChangeText={setCustomRole}
								placeholder='その他の役割 (英小文字)'
								autoCapitalize='none'
								editable={!saving}
								style={styles.flex}
							/>
							<Button
								title='追加'
								variant='secondary'
								disabled={saving || !customRole.trim() || agents.some(a => a.role === customRole.trim())}
								onPress={() => {
									const role = customRole.trim();
									setCustomRole('');
									setAgents(prev => [...prev, {
										role,
										provider: providers[0]?.provider ?? '',
										model: providers[0]?.models[0] ?? '',
									}]);
								}}
							/>
						</Row>
					</Card>

					<Button title='保存' icon='check' onPress={() => void save()} loading={saving} disabled={!dirty || !name.trim()} />
					<Button title='このプロジェクトを削除' icon='trash-2' variant='ghost' disabled={saving} onPress={() => void remove()} style={styles.centered} />
				</ScrollView>
			</KeyboardAvoidingView>
		</Sheet>
	);
};

/** プロジェクトの役割割り当てをソーシャルに公開する。共有タブからも同じことができる。 */
const ShareSheet = ({
	project,
	onClose,
	onDone,
}: {
	project: DivisionProject;
	onClose: () => void;
	onDone: (message: string) => void;
}) => {
	const { session } = useDivisionAuth();
	const [title, setTitle] = useState(defaultPostTitle(project));
	const [description, setDescription] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const run = useCallback(async () => {
		if (!session) return;
		setBusy(true);
		setError(null);
		try {
			await publishAssignmentPost(session, {
				title,
				description,
				assignments: toPostAssignments(project.agents),
				sourceProjectId: project.projectId,
			});
			onDone('共有しました。共有タブから確認できます。');
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}, [session, project, title, description, onClose, onDone]);

	return (
		<Sheet title='役割の割り当てを共有' eyebrow={project.name} onClose={onClose}>
			<KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
				<ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps='handled'>
					{!session ? (
						<Card><Muted>共有するには Division アカウントでログインしてください。</Muted></Card>
					) : (
						<>
							<Card>
								<Muted>タイトル</Muted>
								<Input value={title} onChangeText={setTitle} placeholder='例: コスト重視の構成' />
								<Muted>説明 (任意)</Muted>
								<Input value={description} onChangeText={setDescription} placeholder='どんな用途に向くかなど' multiline />
							</Card>
							<Card>
								<SectionTitle>共有される内容</SectionTitle>
								{project.agents.map((a, i) => (
									<Row key={`${a.role}-${i}`} style={styles.spread}>
										<Muted>{roleTitle(a.role)}</Muted>
										<Body>{a.model || '(未設定)'}</Body>
									</Row>
								))}
								<Muted>API キーやコードは共有されません。</Muted>
							</Card>
							{error ? <ErrorBanner message={error} style={styles.bannerFlush} /> : null}
							<Button
								title='共有する'
								icon='share-2'
								loading={busy}
								disabled={!title.trim() || project.agents.length === 0}
								onPress={() => void run()}
							/>
						</>
					)}
				</ScrollView>
			</KeyboardAvoidingView>
		</Sheet>
	);
};

/** カードに出す割り当ての抜粋 (先頭 4 件) と役割の数。 */
const AgentPreview = ({ agents }: { agents: RoleAssignment[] }) => (
	<>
		<View style={styles.agentPreview}>
			{agents.slice(0, 4).map((a, i) => (
				<Text key={`${a.role}-${i}`} style={styles.agentPreviewText} numberOfLines={1}>
					{roleTitle(a.role)} → {a.model || '(未設定)'}
				</Text>
			))}
			{agents.length > 4 ? <Muted>他 {agents.length - 4} 件</Muted> : null}
		</View>
		<Text style={styles.metaLine} numberOfLines={1}>{agents.length} 役割</Text>
	</>
);

/** 検索欄の文字で名前・ID を絞り込む (大文字小文字は区別しない)。 */
const matchesQuery = (query: string, ...fields: (string | undefined)[]) => {
	const q = query.trim().toLowerCase();
	return !q || fields.some(f => (f ?? '').toLowerCase().includes(q));
};

/** モックアップの検索欄 (一覧の上)。 */
const ProjectSearch = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
	<Input
		accessibilityLabel='検索'
		value={value}
		onChangeText={onChange}
		placeholder='プロジェクトを検索'
		autoCapitalize='none'
		autoCorrect={false}
		style={styles.search}
	/>
);

/** カード下の操作 (モックアップ: 「セッションを起動」「カンバン」)。 */
const ProjectCardActions = ({ onOpenPage, connected }: { onOpenPage?: OpenPage; connected: boolean }) => (
	onOpenPage ? (
		<Row style={styles.cardActions}>
			{/* 一覧の行ごとに並ぶ操作。塗りの主ボタンを何個も並べず、枠のボタンにする (アクセントは画面の主操作だけに使う) */}
			<Button title='セッションを起動' icon='play' size='sm' variant='secondary' onPress={() => onOpenPage('cloud')} />
			{connected ? <Button title='カンバン' size='sm' variant='secondary' onPress={() => onOpenPage('kanban')} /> : null}
		</Row>
	) : null
);

export const ProjectsScreen = ({ onOpenPage }: { onOpenPage?: OpenPage } = {}) => {
	const [query, setQuery] = useState('');
	const { snapshot, error, refresh, isRefreshing, invalidate, client } = useApp();
	const { session } = useDivisionAuth();

	const toast = useToast();
	const [providers, setProviders] = useState<ProviderModels[]>([]);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [sharingId, setSharingId] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const [newName, setNewName] = useState('');
	const [newId, setNewId] = useState('');
	const [syncing, setSyncing] = useState<'pull' | 'push' | null>(null);

	const division = snapshot?.division ?? null;
	const connected = !!client && !!snapshot && !!division;

	// PC に繋いでいないときは、Division API (Web のディビジョンプロジェクトと同じ一覧) を読み書きする。
	const server = useServerProjects(session, !connected);
	const serverEditing = useMemo(
		() => (connected ? null : server.projects.find(p => p.projectId === editingId) ?? null),
		[connected, server.projects, editingId],
	);
	const serverSharing = useMemo(
		() => (connected ? null : server.projects.find(p => p.projectId === sharingId) ?? null),
		[connected, server.projects, sharingId],
	);
	const editing = useMemo(
		() => division?.projects.find(p => p.projectId === editingId) ?? null,
		[division, editingId],
	);
	const sharing = useMemo(
		() => division?.projects.find(p => p.projectId === sharingId) ?? null,
		[division, sharingId],
	);

	// モデル一覧は滅多に変わらないので、接続ごとに 1 回だけ取る。
	useEffect(() => {
		if (!client) return;
		let cancelled = false;
		void (async () => {
			try {
				const list = await client.getProviderModels();
				if (!cancelled) setProviders(list);
			} catch {
				// 取得できなくてもプロジェクト名の編集はできる
			}
		})();
		return () => { cancelled = true; };
	}, [client]);

	const act = useCallback(async (fn: () => Promise<unknown>, successNote?: string): Promise<boolean> => {
		try {
			await fn();
			if (successNote) toast.show(successNote, 'success');
			invalidate();
			return true;
		} catch (e) {
			toast.show(e instanceof OrchestraApiError ? e.userMessage : String(e), 'error');
			return false;
		}
	}, [invalidate, toast]);

	const serverAct = useCallback(async (fn: () => Promise<unknown>, successNote: string): Promise<boolean> => {
		try {
			await fn();
			toast.show(successNote, 'success');
			return true;
		} catch (e) {
			toast.show(e instanceof Error ? e.message : String(e), 'error');
			return false;
		}
	}, [toast]);

	// PC 未接続: Division API のプロジェクト (Web のディビジョンプロジェクトと同じ一覧) をその場で編集する。
	if (!connected) {
		return (
			<Screen>
				<ScreenHeader title='プロジェクト' />
				<ScrollView
					contentContainerStyle={styles.content}
					refreshControl={<RefreshControl refreshing={server.loading} onRefresh={server.reload} tintColor={colors.fgMuted} />}
				>
					<ProjectSearch value={query} onChange={setQuery} />
					<Card>
						<Row>
							<Icon name='cloud' size={16} color={colors.accentText} />
							<Body>クラウドのプロジェクト</Body>
						</Row>
						<Muted>Web のディビジョンプロジェクトと同じ一覧です。PC に接続しなくても、役割とモデルの割り当ての編集・追加・削除・共有ができます。クラウドエージェントはここの割り当てで動きます。</Muted>
					</Card>

					{!session ? (
						<EmptyState icon='log-in' title='Division にログインしてください' detail='ログインすると、クラウドのプロジェクトを編集できます。' />
					) : null}
					{server.error ? <ErrorBanner message={server.error} onRetry={server.reload} style={styles.bannerFlush} /> : null}
					{server.loading && server.projects.length === 0 ? (
						<Loading label='プロジェクトを読み込んでいます…' />
					) : null}
					{session && !server.loading && !server.error && server.projects.length === 0 ? (
						<EmptyState icon='layers' title='プロジェクトがありません' detail='下の「プロジェクトを追加」から作れます。' />
					) : null}

					{server.projects.filter(p => matchesQuery(query, p.name, p.projectId)).map(project => (
						<Card key={project.projectId}>
							<Row style={styles.spread}>
								<View style={styles.flex}>
									<Body numberOfLines={1}>{project.name}</Body>
									<Muted numberOfLines={1}>{project.projectId}</Muted>
								</View>
								<IconButton
									icon='share-2'
									accessibilityLabel={`${project.name} の割り当てを共有`}
									disabled={project.agents.length === 0}
									onPress={() => setSharingId(project.projectId)}
								/>
								<IconButton icon='edit-2' accessibilityLabel={`${project.name} を編集`} onPress={() => setEditingId(project.projectId)} />
							</Row>
							<AgentPreview agents={project.agents} />
							<ProjectCardActions onOpenPage={onOpenPage} connected={false} />
						</Card>
					))}

					{session ? (
						adding ? (
							<Card>
								<SectionTitle>プロジェクトを追加</SectionTitle>
								<Input value={newName} onChangeText={setNewName} placeholder='プロジェクト名' autoFocus />
								<Muted>役割の割り当ては、一覧の先頭のプロジェクトのものから始まります。追加したあとに「編集」で変えられます。</Muted>
								<Row>
									<Button
										title='追加'
										style={styles.flex}
										disabled={!newName.trim()}
										onPress={() => {
											const agents = server.projects[0]?.agents ?? [];
											void serverAct(() => server.create({ name: newName.trim(), agents }), 'プロジェクトを追加しました').then(ok => {
												if (!ok) return;
												setNewName('');
												setAdding(false);
											});
										}}
									/>
									<Button title='やめる' variant='secondary' onPress={() => setAdding(false)} />
								</Row>
							</Card>
						) : (
							<Button title='プロジェクトを追加' icon='plus' variant='secondary' onPress={() => setAdding(true)} />
						)
					) : null}
					{onOpenPage ? <Button title='＋ リポジトリを追加' variant='secondary' onPress={() => onOpenPage('cloud')} /> : null}
				</ScrollView>

				{serverEditing ? (
					<ProjectEditor
						project={serverEditing}
						providers={server.providers}
						onClose={() => setEditingId(null)}
						onSave={async (name, agents) => {
							if (await serverAct(() => server.save(serverEditing.projectId, { name, agents }), '保存しました')) setEditingId(null);
						}}
						onDelete={async () => {
							if (await serverAct(() => server.remove(serverEditing.projectId), 'プロジェクトを削除しました')) setEditingId(null);
						}}
					/>
				) : null}

				{serverSharing ? (
					<ShareSheet
						project={serverSharing}
						onClose={() => setSharingId(null)}
						onDone={message => toast.show(message, 'success')}
					/>
				) : null}
			</Screen>
		);
	}

	if (!division) {
		return (
			<Screen>
				{error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}
				<Loading label='プロジェクトを読み込んでいます…' />
			</Screen>
		);
	}

	return (
		<Screen>
			<ScreenHeader
				title='プロジェクト'
				right={(
					<>
						<IconButton
							icon='download-cloud'
							accessibilityLabel='クラウドから取得'
							disabled={syncing !== null}
							onPress={() => {
								setSyncing('pull');
								void act(() => client.pullProjectsFromSupabase(), 'クラウドから取得しました').finally(() => setSyncing(null));
							}}
						/>
						<IconButton
							icon='upload-cloud'
							accessibilityLabel='クラウドへ保存'
							disabled={syncing !== null}
							onPress={() => {
								setSyncing('push');
								void act(() => client.pushProjectsToSupabase(), 'クラウドへ保存しました').finally(() => setSyncing(null));
							}}
						/>
					</>
				)}
			/>
			{error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}

			<ScrollView
				contentContainerStyle={styles.content}
				refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refresh()} tintColor={colors.fgMuted} />}
			>
				<ProjectSearch value={query} onChange={setQuery} />
				{division.projects.length === 0 ? (
					<EmptyState icon='layers' title='プロジェクトがありません' />
				) : null}

				{division.projects.filter(p => matchesQuery(query, p.name, p.projectId)).map(project => (
					<Card key={project.projectId || project.name}>
						<Row style={styles.spread}>
							<View style={styles.flex}>
								<Body numberOfLines={1}>{project.name}</Body>
								<Muted numberOfLines={1}>{project.projectId || 'ID 未設定'}</Muted>
							</View>
							<StatusBadge label={project.isActive ? '有効' : '無効'} color={project.isActive ? colors.success : colors.fgFaint} />
							<IconButton
								icon='share-2'
								accessibilityLabel={`${project.name} の割り当てを共有`}
								disabled={project.agents.length === 0}
								onPress={() => setSharingId(project.projectId)}
							/>
							<IconButton icon='edit-2' accessibilityLabel={`${project.name} を編集`} onPress={() => setEditingId(project.projectId)} />
						</Row>

						<AgentPreview agents={project.agents} />

						<Row>
							<Button
								title={project.isActive ? 'このプロジェクトのみ有効' : '有効にする'}
								variant={project.isActive ? 'secondary' : 'primary'}
								size='sm'
								onPress={() => void act(() => client.activateProject(project.projectId, true), `${project.name} を有効にしました`)}
							/>
							<Button
								title={project.isActive ? '無効' : '併用'}
								variant='ghost'
								size='sm'
								onPress={() => void act(() => client.activateProject(project.projectId, false))}
							/>
						</Row>
						<ProjectCardActions onOpenPage={onOpenPage} connected />
					</Card>
				))}

				{adding ? (
					<Card>
						<SectionTitle>プロジェクトを追加</SectionTitle>
						<Input value={newName} onChangeText={setNewName} placeholder='プロジェクト名' autoFocus />
						<Input value={newId} onChangeText={setNewId} placeholder='プロジェクト ID (任意)' autoCapitalize='none' />
						<Row>
							<Button
								title='追加'
								style={styles.flex}
								disabled={!newName.trim()}
								onPress={() => {
									const base = division.projects[0]?.agents ?? [];
									void act(
										() => client.addProject({ projectId: newId.trim(), name: newName.trim(), agents: base }),
										'プロジェクトを追加しました',
									).then(ok => {
										if (!ok) return;
										setNewName('');
										setNewId('');
										setAdding(false);
									});
								}}
							/>
							<Button title='やめる' variant='secondary' onPress={() => setAdding(false)} />
						</Row>
					</Card>
				) : (
					<>
						<Button title='プロジェクトを追加' icon='plus' variant='secondary' onPress={() => setAdding(true)} />
						{onOpenPage ? <Button title='＋ リポジトリを追加' variant='secondary' onPress={() => onOpenPage('cloud')} /> : null}
					</>
				)}
			</ScrollView>

			{editing ? (
				<ProjectEditor
					project={editing}
					providers={providers}
					onClose={() => setEditingId(null)}
					onSave={async (name, agents) => {
						if (await act(() => client.saveProject(editing.projectId, { name, agents }), '保存しました')) setEditingId(null);
					}}
					onDelete={async () => {
						if (await act(() => client.deleteProject(editing.projectId), 'プロジェクトを削除しました')) setEditingId(null);
					}}
				/>
			) : null}

			{sharing ? (
				<ShareSheet
					project={sharing}
					onClose={() => setSharingId(null)}
					onDone={message => toast.show(message, 'success')}
				/>
			) : null}
		</Screen>
	);
};

const styles = StyleSheet.create({
	flex: { flex: 1 },
	spread: { justifyContent: 'space-between' },
	search: { marginBottom: spacing.sm },
	cardActions: { marginTop: spacing.sm },
	metaLine: { color: colors.fgFaint, fontSize: fontSize.xs, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
	centered: { alignSelf: 'center' },
	bannerFlush: { margin: 0 },
	roleChips: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: spacing.xs,
	},
	roleChip: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
		minHeight: 40,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radius.lg,
		paddingHorizontal: spacing.md,
	},
	roleChipText: {
		color: colors.accentText,
		fontSize: fontSize.xs,
		fontWeight: '600',
	},
	content: {
		paddingHorizontal: spacing.lg,
		// 検索欄が見出しの線に張り付かないように、上にも余白を取る
		paddingTop: spacing.md,
		paddingBottom: spacing.xl,
		gap: spacing.md,
	},
	agentRow: {
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radius.sm,
		padding: spacing.sm,
		gap: spacing.sm,
	},
	agentHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
		minHeight: 44,
	},
	agentPreview: {
		gap: 2,
	},
	agentPreviewText: {
		color: colors.fgMuted,
		fontSize: fontSize.xs,
	},
	modelList: {
		gap: spacing.sm,
	},
	providerBlock: {
		gap: spacing.xs,
	},
	modelChips: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: spacing.xs,
	},
	modelChip: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
		minHeight: 44,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: 999,
		paddingHorizontal: spacing.sm + 2,
		paddingVertical: spacing.xs,
	},
	modelChipSelected: {
		borderColor: colors.borderStrong,
		backgroundColor: colors.bgHover,
	},
	modelChipText: {
		color: colors.fgMuted,
		fontSize: fontSize.xs,
	},
	link: {
		color: colors.accentText,
		fontSize: fontSize.xs,
		fontWeight: '600',
	},
});

