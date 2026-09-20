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
	Modal,
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
	Input,
	Loading,
	Muted,
	Row,
	Screen,
	ScreenHeader,
	SectionTitle,
	Title,
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
		<Modal animationType='slide' presentationStyle='pageSheet' onRequestClose={onClose}>
			<Screen>
				<View style={styles.modalHeader}>
					<View style={styles.flex}>
						<Muted>取り込み</Muted>
						<Title>{post.title}</Title>
					</View>
					<Pressable accessibilityRole='button' onPress={onClose}><Text style={styles.link}>閉じる</Text></Pressable>
				</View>

				<ScrollView contentContainerStyle={styles.content}>
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

					{error ? <ErrorBanner message={error} /> : null}
					<Button title='取り込む' onPress={() => void run()} loading={busy} />
				</ScrollView>
			</Screen>
		</Modal>
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
			onDone('共有しました。');
			onClose();
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	}, [session, project, title, description, onClose, onDone]);

	return (
		<Modal animationType='slide' presentationStyle='pageSheet' onRequestClose={onClose}>
			<Screen>
				<View style={styles.modalHeader}>
					<Title>役割の割り当てを共有</Title>
					<Pressable accessibilityRole='button' onPress={onClose}><Text style={styles.link}>閉じる</Text></Pressable>
				</View>

				<ScrollView contentContainerStyle={styles.content}>
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

					{error ? <ErrorBanner message={error} /> : null}
					<Button title='共有する' onPress={() => void run()} loading={busy} disabled={!project || !title.trim()} />
				</ScrollView>
			</Screen>
		</Modal>
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
			<Pressable accessibilityRole='button' onPress={() => setOpen(o => !o)}>
				<Row style={styles.spread}>
					<View style={styles.flex}>
						<Body>{post.title}</Body>
						<Muted>{post.authorName} · {relativeTimeFromIso(post.createdAt)}</Muted>
					</View>
					{post.mine ? <Badge label='自分の投稿' color={colors.accentText} /> : null}
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
							<Button title='編集' variant='ghost' onPress={onEdit} />
							<Button title='削除' variant='ghost' onPress={onDelete} />
						</>
					) : null}
					<Button title='取り込む' variant='secondary' onPress={onImport} disabled={!canImport} />
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
	onSave: (patch: { title: string; description: string }) => Promise<void>;
}) => {
	const [title, setTitle] = useState(post.title);
	const [description, setDescription] = useState(post.description);
	const [busy, setBusy] = useState(false);

	return (
		<Modal animationType='slide' presentationStyle='pageSheet' onRequestClose={onClose}>
			<Screen>
				<View style={styles.modalHeader}>
					<Title>投稿を編集</Title>
					<Pressable accessibilityRole='button' onPress={onClose}><Text style={styles.link}>閉じる</Text></Pressable>
				</View>
				<ScrollView contentContainerStyle={styles.content}>
					<Card>
						<Muted>タイトル</Muted>
						<Input value={title} onChangeText={setTitle} />
						<Muted>説明</Muted>
						<Input value={description} onChangeText={setDescription} multiline />
						<Muted>役割の割り当ては変更できません。作り直す場合は削除してから共有し直してください。</Muted>
					</Card>
					<Button
						title='保存'
						loading={busy}
						disabled={!title.trim()}
						onPress={() => {
							setBusy(true);
							void onSave({ title, description }).finally(() => { setBusy(false); onClose(); });
						}}
					/>
				</ScrollView>
			</Screen>
		</Modal>
	);
};

// ---------------------------------------------------------------------------
// 画面本体
// ---------------------------------------------------------------------------

export const SocialScreen = () => {
	const { session } = useDivisionAuth();
	const { snapshot, client } = useApp();

	const [posts, setPosts] = useState<AssignmentPost[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
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
			setNotice(errorText(e));
		}
	}, [session]);

	const remove = useCallback(async (post: AssignmentPost) => {
		if (!session) return;
		try {
			await deleteAssignmentPost(session, post.id);
			setPosts(prev => prev?.filter(p => p.id !== post.id) ?? prev);
			setNotice('削除しました。');
		} catch (e) {
			setNotice(errorText(e));
		}
	}, [session]);

	const saveEdit = useCallback(async (post: AssignmentPost, patch: { title: string; description: string }) => {
		if (!session) return;
		try {
			await updateAssignmentPost(session, post.id, patch);
			setPosts(prev => prev?.map(p => (p.id === post.id ? { ...p, ...patch } : p)) ?? prev);
			setNotice('保存しました。');
		} catch (e) {
			setNotice(errorText(e));
		}
	}, [session]);

	if (!session) {
		return (
			<Screen>
				<ScreenHeader title='ソーシャル' />
				<EmptyState
					title='Division にログインしてください'
					detail='共有された役割の割り当ては、Division アカウントでログインすると閲覧できます。'
				/>
			</Screen>
		);
	}

	return (
		<Screen>
			<ScreenHeader title='ソーシャル' subtitle='役割とモデルの組み合わせを共有・取り込みする' />

			<View style={styles.toolbar}>
				<ChipGroup<'feed' | 'mine'>
					options={[{ value: 'feed', label: 'みんなの投稿' }, { value: 'mine', label: '自分の投稿' }]}
					value={tab}
					onChange={setTab}
				/>
				<ChipGroup<FeedSort> options={FEED_SORTS} value={sort} onChange={setSort} />
				<Row>
					<Input
						value={query}
						onChangeText={setQuery}
						placeholder='タイトル・モデル名で検索'
						style={styles.flex}
						autoCapitalize='none'
					/>
					<Button
						title='共有'
						variant='secondary'
						disabled={!canUseProjects || projects.length === 0}
						onPress={() => setPublishing(true)}
					/>
				</Row>
				{!canUseProjects ? <Muted>PC に接続すると、自分のプロジェクトの共有と取り込みができます。</Muted> : null}
			</View>

			{error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

			{posts === null && !error ? (
				<Loading label='投稿を読み込んでいます…' />
			) : (
				<ScrollView
					contentContainerStyle={styles.content}
					refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />}
				>
					{visible.length === 0 ? (
						<EmptyState
							title={tab === 'mine' ? 'まだ共有していません' : '投稿がありません'}
							detail={tab === 'mine'
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

					{notice ? <Text style={styles.notice}>{notice}</Text> : null}
				</ScrollView>
			)}

			{importing ? (
				<ImportSheet
					post={importing}
					projects={projects}
					onClose={() => setImporting(null)}
					onDone={message => { setNotice(message); void load(); }}
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
					onDone={message => { setNotice(message); void load(); }}
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
	modalHeader: {
		flexDirection: 'row',
		alignItems: 'flex-start',
		justifyContent: 'space-between',
		gap: spacing.sm,
		padding: spacing.lg,
		borderBottomWidth: 1,
		borderBottomColor: colors.border,
	},
	link: {
		color: colors.accentText,
		fontSize: fontSize.sm,
		fontWeight: '600',
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
	notice: {
		color: colors.fgMuted,
		fontSize: fontSize.xs,
		textAlign: 'center',
	},
});
