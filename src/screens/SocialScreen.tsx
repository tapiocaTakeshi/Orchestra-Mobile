/**
 * ソーシャルのタブ。
 *
 * Division の「どの役割をどのモデルに振るか」という設定を、他のユーザーと
 * 共有する場所。フィードから気に入った組み合わせを自分のプロジェクトに
 * 取り込んだり、自分のプロジェクトを公開したりできる。
 *
 * 投稿の読み書きは Supabase 直結なので、PC に接続していなくても閲覧できる。
 * 取り込み・公開だけは IDE のプロジェクトを触るので接続が要る。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
	Pressable,
	RefreshControl,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native';

import { OrchestraApiError } from '../api/client';
import { DivisionProject } from '../api/types';
import {
	Badge,
	Body,
	Button,
	Card,
	ChipGroup,
	Divider,
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
	SegmentedControl,
	Sheet,
	confirmAction,
	useToast,
} from '../components/ui';
import { relativeTimeFromIso } from '../lib/format';
import {
	deleteAssignmentPost,
	importAssignmentPost,
	listAssignmentPosts,
	publishAssignmentPost,
	setPostLike,
	updateAssignmentPost,
} from '../lib/divisionSocial';
import {
	AssignmentPost,
	FEED_SORTS,
	FeedSort,
	assignmentSummary,
	defaultPostTitle,
	filterPosts,
	mergeAssignments,
	toPostAssignments,
	toRoleAssignments,
	usedProviders,
} from '../lib/social';
import { useApp } from '../state/AppContext';
import { useDivisionAuth } from '../state/DivisionAuthContext';
import { colors, fontSize, radius, spacing } from '../theme';

const errorText = (e: unknown): string =>
	e instanceof OrchestraApiError ? e.userMessage : e instanceof Error ? e.message : String(e);

// ---------------------------------------------------------------------------
// 取り込み
// ---------------------------------------------------------------------------

type ImportMode = 'merge' | 'replace' | 'new';

const ImportSheet = ({
	post,
	projects,
	onClose,
	onDone,
}: {
	post: AssignmentPost;
	projects: DivisionProject[];
	onClose: () => void;
	onDone: (message: string) => void;
}) => {
	const { client, invalidate } = useApp();
	const { session } = useDivisionAuth();

	const [targetId, setTargetId] = useState<string | null>(projects[0]?.projectId ?? null);
	const [mode, setMode] = useState<ImportMode>(projects.length === 0 ? 'new' : 'merge');
	const [newName, setNewName] = useState(post.title);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const target = projects.find(p => p.projectId === targetId) ?? null;

	const run = useCallback(async () => {
		if (!client || !session) return;
		setBusy(true);
		setError(null);
		try {
			// 取り込み数を増やしつつ、投稿時点の割り当てを取り直す。
			const assignments = toRoleAssignments(await importAssignmentPost(session, post.id));
			if (assignments.length === 0) throw new Error('この投稿には割り当てが入っていません。');

			if (mode === 'new') {
				const name = newName.trim() || post.title;
				await client.addProject({
					projectId: `${name.replace(/\s+/g, '-').toLowerCase()}-${Date.now().toString(36)}`,
					name,
					agents: assignments,
				});
				onDone(`「${name}」として取り込みました。`);
			} else {
				if (!target) throw new Error('取り込み先のプロジェクトを選んでください。');
				const next = mode === 'replace' ? assignments : mergeAssignments(target.agents, assignments);
				await client.saveProject(target.projectId, { agents: next });
				onDone(`「${target.name}」に取り込みました。`);
			}
			invalidate();
			onClose();
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	}, [client, session, post, mode, target, newName, invalidate, onClose, onDone]);

	return (
		<Sheet title={post.title} eyebrow='取り込み' onClose={onClose}>
			<ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps='handled'>
				<Card>
					<SectionTitle>取り込み方</SectionTitle>
					<ChipGroup<ImportMode>
						options={[
							{ value: 'merge', label: '既存に重ねる' },
							{ value: 'replace', label: '既存を置き換える' },
							{ value: 'new', label: '新しいプロジェクト' },
						]}
						value={mode}
						onChange={setMode}
					/>
					<Muted>
						{mode === 'merge' ? '同じ役割は投稿の内容で上書きし、投稿にしかない役割は追加します。'
							: mode === 'replace' ? 'プロジェクトの割り当てをすべて投稿の内容に置き換えます。'
								: '新しい Division プロジェクトを作って、その中身にします。'}
					</Muted>
				</Card>

				{mode === 'new' ? (
					<Card>
						<SectionTitle>プロジェクト名</SectionTitle>
						<Input value={newName} onChangeText={setNewName} placeholder='プロジェクト名' />
					</Card>
				) : (
					<Card>
						<SectionTitle>取り込み先</SectionTitle>
						{projects.length === 0 ? <Muted>プロジェクトがありません。「新しいプロジェクト」を選んでください。</Muted> : null}
						{projects.map(p => {
							const selected = p.projectId === targetId;
							return (
								<Pressable
									key={p.projectId}
									accessibilityRole='button'
									accessibilityState={{ selected }}
									onPress={() => setTargetId(p.projectId)}
									style={[styles.selectRow, selected && styles.selectRowActive]}
								>
									<View style={styles.flex}>
										<Body>{p.name}</Body>
										<Muted>{p.agents.length} 役割{p.isActive ? ' · 有効' : ''}</Muted>
									</View>
									{selected ? <Icon name='check' color={colors.accentText} /> : null}
								</Pressable>
							);
						})}
					</Card>
				)}

				<Card>
					<SectionTitle>取り込まれる割り当て</SectionTitle>
					{post.assignments.map(a => (
						<Row key={`${a.roleSlug}-${a.priority}`} style={styles.spread}>
							<Muted>{a.roleName}</Muted>
							<Body>{a.modelDisplayName || a.model}</Body>
						</Row>
					))}
				</Card>

				{error ? <ErrorBanner message={error} style={styles.bannerFlush} /> : null}
				<Button title='取り込む' icon='download' onPress={() => void run()} loading={busy} disabled={mode !== 'new' && !target} />
			</ScrollView>
		</Sheet>
	);
};

// ---------------------------------------------------------------------------
// 公開
// ---------------------------------------------------------------------------

const PublishSheet = ({
	projects,
	onClose,
	onDone,
}: {
	projects: DivisionProject[];
	onClose: () => void;
	onDone: (message: string) => void;
}) => {
	const { session } = useDivisionAuth();
	const [projectId, setProjectId] = useState<string | null>(projects[0]?.projectId ?? null);
	const [title, setTitle] = useState(projects[0] ? defaultPostTitle(projects[0]) : '');
	const [description, setDescription] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const project = projects.find(p => p.projectId === projectId) ?? null;

	const run = useCallback(async () => {
		if (!session || !project) return;
		setBusy(true);
		setError(null);
		try {
			await publishAssignmentPost(session, {
				title,
				description,
				assignments: toPostAssignments(project.agents),
				sourceProjectId: project.projectId,
			});
			onDone('共有しました');
			onClose();
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	}, [session, project, title, description, onClose, onDone]);

	return (
		<Sheet title='役割の割り当てを共有' onClose={onClose}>
			<ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps='handled'>
				<Card>
					<SectionTitle>共有するプロジェクト</SectionTitle>
					{projects.length === 0 ? <Muted>共有できるプロジェクトがありません。</Muted> : null}
					{projects.map(p => {
						const selected = p.projectId === projectId;
						return (
							<Pressable
								key={p.projectId}
								accessibilityRole='button'
								accessibilityState={{ selected }}
								onPress={() => { setProjectId(p.projectId); setTitle(defaultPostTitle(p)); }}
								style={[styles.selectRow, selected && styles.selectRowActive]}
							>
								<View style={styles.flex}>
									<Body>{p.name}</Body>
									<Muted>{assignmentSummary(toPostAssignments(p.agents))}</Muted>
								</View>
								{selected ? <Icon name='check' color={colors.accentText} /> : null}
							</Pressable>
						);
					})}
				</Card>

				<Card>
					<SectionTitle>公開する内容</SectionTitle>
					<Muted>タイトル</Muted>
					<Input value={title} onChangeText={setTitle} placeholder='例: コスト重視の構成' />
					<Muted>説明 (任意)</Muted>
					<Input value={description} onChangeText={setDescription} placeholder='どんな用途に向くかなど' multiline />
					<Muted>共有されるのは役割とモデルの組み合わせだけです。API キーやコードは含まれません。</Muted>
				</Card>

				{error ? <ErrorBanner message={error} style={styles.bannerFlush} /> : null}
				<Button title='共有する' icon='share-2' onPress={() => void run()} loading={busy} disabled={!project || !title.trim()} />
			</ScrollView>
		</Sheet>
	);
};

// ---------------------------------------------------------------------------
// 投稿カード
// ---------------------------------------------------------------------------

const PostCard = ({
	post,
	canImport,
	onLike,
	onImport,
	onEdit,
	onDelete,
}: {
	post: AssignmentPost;
	canImport: boolean;
	onLike: () => void;
	onImport: () => void;
	onEdit: () => void;
	onDelete: () => void;
}) => {
	const [open, setOpen] = useState(false);

	return (
		<Card>
			<Pressable
				accessibilityRole='button'
				accessibilityState={{ expanded: open }}
				accessibilityHint='タップで割り当ての詳細を開閉します'
				onPress={() => setOpen(o => !o)}
			>
				<Row style={styles.spread}>
					<View style={styles.flex}>
						<Body>{post.title}</Body>
						<Muted>{post.authorName} · {relativeTimeFromIso(post.createdAt)}</Muted>
					</View>
					{post.mine ? <Badge label='自分の投稿' color={colors.accentText} /> : null}
					<Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.fgFaint} />
				</Row>
			</Pressable>

			{post.description ? <Muted numberOfLines={open ? undefined : 2}>{post.description}</Muted> : null}

			<Muted>{assignmentSummary(post.assignments)}</Muted>

			<View style={styles.badgeRow}>
				{usedProviders(post.assignments).slice(0, 4).map(name => (
					<Badge key={name} label={name} color={colors.fgMuted} />
				))}
				<Badge label={`${post.assignments.length} 役割`} />
			</View>

			{open ? (
				<>
					<Divider />
					{[...post.assignments].sort((a, b) => a.priority - b.priority).map(a => (
						<Row key={`${a.roleSlug}-${a.priority}`} style={styles.spread}>
							<Muted>{a.roleName}</Muted>
							<Text style={styles.assignmentModel}>{a.modelDisplayName || a.model}</Text>
						</Row>
					))}
				</>
			) : null}

			<Divider />

			<Row style={styles.spread}>
				<Row>
					<Pressable
						accessibilityRole='button'
						accessibilityLabel={post.likedByMe ? 'いいねを取り消す' : 'いいねする'}
						accessibilityState={{ selected: post.likedByMe }}
						onPress={onLike}
						style={styles.iconAction}
					>
						<Icon name='heart' size={18} color={post.likedByMe ? colors.danger : colors.fgFaint} />
						<Text style={[styles.countText, post.likedByMe && { color: colors.danger }]}>{post.likeCount}</Text>
					</Pressable>
					<Row style={styles.iconAction}>
						<Icon name='download' size={18} color={colors.fgFaint} />
						<Text style={styles.countText}>{post.importCount}</Text>
					</Row>
				</Row>

				<Row>
					{post.mine ? (
						<>
							<IconButton icon='edit-2' accessibilityLabel='投稿を編集' onPress={onEdit} />
							<IconButton icon='trash-2' accessibilityLabel='投稿を削除' onPress={onDelete} />
						</>
					) : null}
					<Button title='取り込む' icon='download' size='sm' variant='secondary' onPress={onImport} disabled={!canImport} />
				</Row>
			</Row>
		</Card>
	);
};

const EditSheet = ({
	post,
	onClose,
	onSave,
}: {
	post: AssignmentPost;
	onClose: () => void;
	onSave: (patch: { title: string; description: string }) => Promise<boolean>;
}) => {
	const [title, setTitle] = useState(post.title);
	const [description, setDescription] = useState(post.description);
	const [busy, setBusy] = useState(false);

	return (
		<Sheet title='投稿を編集' eyebrow={post.title} onClose={onClose}>
			<ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps='handled'>
				<Card>
					<Muted>タイトル</Muted>
					<Input value={title} onChangeText={setTitle} />
					<Muted>説明</Muted>
					<Input value={description} onChangeText={setDescription} multiline />
					<Muted>役割の割り当ては変更できません。作り直す場合は削除してから共有し直してください。</Muted>
				</Card>
				<Button
					title='保存'
					icon='check'
					loading={busy}
					disabled={!title.trim()}
					onPress={() => {
						setBusy(true);
						// 失敗したときは入力を残したまま開いておく (トーストで理由を出す)。
						void onSave({ title, description }).then(ok => {
							setBusy(false);
							if (ok) onClose();
						});
					}}
				/>
			</ScrollView>
		</Sheet>
	);
};

// ---------------------------------------------------------------------------
// 画面本体
// ---------------------------------------------------------------------------

export const SocialScreen = () => {
	const { session } = useDivisionAuth();
	const { snapshot, client } = useApp();
	const toast = useToast();

	const [posts, setPosts] = useState<AssignmentPost[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);

	const [tab, setTab] = useState<'feed' | 'mine'>('feed');
	const [sort, setSort] = useState<FeedSort>('new');
	const [query, setQuery] = useState('');

	const [importing, setImporting] = useState<AssignmentPost | null>(null);
	const [editing, setEditing] = useState<AssignmentPost | null>(null);
	const [publishing, setPublishing] = useState(false);

	const projects = snapshot?.division.projects ?? [];
	const canUseProjects = !!client && !!snapshot;

	const load = useCallback(async () => {
		if (!session) return;
		setError(null);
		try {
			setPosts(await listAssignmentPosts(session));
		} catch (e) {
			setError(errorText(e));
		}
	}, [session]);

	useEffect(() => { void load(); }, [load]);

	const refresh = useCallback(async () => {
		setRefreshing(true);
		try { await load(); } finally { setRefreshing(false); }
	}, [load]);

	const visible = useMemo(() => {
		const base = (posts ?? []).filter(p => (tab === 'mine' ? p.mine : true));
		return filterPosts(base, query, sort);
	}, [posts, tab, query, sort]);

	/** いいねは先に画面を更新して、失敗したら戻す (連打しても破綻しないよう id で当てる)。 */
	const toggleLike = useCallback(async (post: AssignmentPost) => {
		if (!session) return;
		const liked = !post.likedByMe;
		setPosts(prev => prev?.map(p => (p.id === post.id
			? { ...p, likedByMe: liked, likeCount: Math.max(0, p.likeCount + (liked ? 1 : -1)) }
			: p)) ?? prev);
		try {
			await setPostLike(session, post.id, liked);
		} catch (e) {
			setPosts(prev => prev?.map(p => (p.id === post.id
				? { ...p, likedByMe: !liked, likeCount: Math.max(0, p.likeCount + (liked ? -1 : 1)) }
				: p)) ?? prev);
			toast.show(errorText(e), 'error');
		}
	}, [session, toast]);

	const remove = useCallback(async (post: AssignmentPost) => {
		if (!session) return;
		const ok = await confirmAction({
			title: '投稿を削除しますか？',
			message: `「${post.title}」を削除します。取り込み済みのプロジェクトには影響しません。`,
			confirmLabel: '削除',
			destructive: true,
		});
		if (!ok) return;
		try {
			await deleteAssignmentPost(session, post.id);
			setPosts(prev => prev?.filter(p => p.id !== post.id) ?? prev);
			toast.show('投稿を削除しました', 'success');
		} catch (e) {
			toast.show(errorText(e), 'error');
		}
	}, [session, toast]);

	const saveEdit = useCallback(async (post: AssignmentPost, patch: { title: string; description: string }): Promise<boolean> => {
		if (!session) return false;
		try {
			await updateAssignmentPost(session, post.id, patch);
			setPosts(prev => prev?.map(p => (p.id === post.id ? { ...p, ...patch } : p)) ?? prev);
			toast.show('保存しました', 'success');
			return true;
		} catch (e) {
			toast.show(errorText(e), 'error');
			return false;
		}
	}, [session, toast]);

	if (!session) {
		return (
			<Screen>
				<ScreenHeader title='共有' />
				<EmptyState
					icon='log-in'
					title='Division にログインしてください'
					detail='共有された役割の割り当ては、Division アカウントでログインすると閲覧できます。'
				/>
			</Screen>
		);
	}

	return (
		<Screen>
			<ScreenHeader title='共有' subtitle='役割とモデルの組み合わせを共有・取り込みする' />

			<View style={styles.toolbar}>
				<SegmentedControl<'feed' | 'mine'>
					options={[{ value: 'feed', label: 'みんなの投稿' }, { value: 'mine', label: '自分の投稿' }]}
					value={tab}
					onChange={setTab}
				/>
				<Row>
					<Input
						value={query}
						onChangeText={setQuery}
						placeholder='タイトル・モデル名で検索'
						style={styles.flex}
						autoCapitalize='none'
						returnKeyType='search'
						clearButtonMode='while-editing'
					/>
					<Button
						title='共有'
						icon='share-2'
						disabled={!canUseProjects || projects.length === 0}
						onPress={() => setPublishing(true)}
					/>
				</Row>
				<ChipGroup<FeedSort> options={FEED_SORTS} value={sort} onChange={setSort} />
			</View>

			{error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

			{posts === null && !error ? (
				<Loading label='投稿を読み込んでいます…' />
			) : (
				<ScrollView
					contentContainerStyle={styles.content}
					refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />}
				>
					{!canUseProjects ? (
						<View style={styles.hint}>
							<Icon name='info' size={16} color={colors.fgMuted} />
							<Muted style={styles.flex}>PC に接続すると、自分のプロジェクトの共有と取り込みができます。</Muted>
						</View>
					) : null}

					{visible.length === 0 ? (
						<EmptyState
							icon={query.trim() ? 'search' : 'share-2'}
							title={query.trim() ? `「${query.trim()}」に一致する投稿はありません` : tab === 'mine' ? 'まだ共有していません' : '投稿がありません'}
							detail={query.trim()
								? '別のキーワードで探すか、検索欄を空にしてください。'
								: tab === 'mine'
									? 'Division タブのプロジェクトを「共有」すると、ここに並びます。'
									: '最初の投稿を共有してみてください。'}
						/>
					) : null}

					{visible.map(post => (
						<PostCard
							key={post.id}
							post={post}
							canImport={canUseProjects}
							onLike={() => void toggleLike(post)}
							onImport={() => setImporting(post)}
							onEdit={() => setEditing(post)}
							onDelete={() => void remove(post)}
						/>
					))}
				</ScrollView>
			)}

			{importing ? (
				<ImportSheet
					post={importing}
					projects={projects}
					onClose={() => setImporting(null)}
					onDone={message => { toast.show(message, 'success'); void load(); }}
				/>
			) : null}

			{editing ? (
				<EditSheet
					post={editing}
					onClose={() => setEditing(null)}
					onSave={patch => saveEdit(editing, patch)}
				/>
			) : null}

			{publishing ? (
				<PublishSheet
					projects={projects}
					onClose={() => setPublishing(false)}
					onDone={message => { toast.show(message, 'success'); void load(); }}
				/>
			) : null}
		</Screen>
	);
};

const styles = StyleSheet.create({
	flex: { flex: 1 },
	spread: { justifyContent: 'space-between' },
	toolbar: {
		padding: spacing.md,
		gap: spacing.sm,
		borderBottomWidth: 1,
		borderBottomColor: colors.border,
	},
	content: {
		padding: spacing.md,
		gap: spacing.md,
		paddingBottom: spacing.xl,
	},
	bannerFlush: { margin: 0 },
	hint: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		padding: spacing.md,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
	},
	badgeRow: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: spacing.xs,
	},
	iconAction: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
		minHeight: 44,
		paddingRight: spacing.sm,
	},
	countText: {
		color: colors.fgFaint,
		fontSize: fontSize.xs,
		fontWeight: '600',
	},
	assignmentModel: {
		color: colors.fg,
		fontSize: fontSize.xs,
		flexShrink: 1,
		textAlign: 'right',
	},
	selectRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radius.sm,
		padding: spacing.md,
		minHeight: 56,
	},
	selectRowActive: {
		borderColor: colors.accent,
		backgroundColor: colors.accentSoft,
	},
});
