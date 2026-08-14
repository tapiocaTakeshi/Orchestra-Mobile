/**
 * Division プロジェクト管理のタブ。
 *
 * ワークスペースの .division/projects.json をそのまま編集する。プロジェクトを
 * 有効にすると IDE 側の roleAssignments (どの役割をどのモデルに振るか) が
 * 切り替わるので、外出先から「今日はコーダーを Opus にする」といった調整ができる。
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
import { DivisionProject, ProviderModels, RoleAssignment } from '../api/types';
import {
	Badge,
	Body,
	Button,
	Card,
	Divider,
	EmptyState,
	ErrorBanner,
	Input,
	Loading,
	Muted,
	Row,
	Screen,
	SectionTitle,
	Title,
} from '../components/ui';
import { providerTitle, roleTitle } from '../lib/format';
import { useApp } from '../state/AppContext';
import { colors, fontSize, radius, spacing } from '../theme';

/** 役割ごとの編集行。モデル一覧はプロバイダーごとに畳んで出す。 */
const AgentRow = ({
	assignment,
	providers,
	onChange,
}: {
	assignment: RoleAssignment;
	providers: ProviderModels[];
	onChange: (next: RoleAssignment) => void;
}) => {
	const [open, setOpen] = useState(false);

	return (
		<View style={styles.agentRow}>
			<Pressable accessibilityRole='button' onPress={() => setOpen(o => !o)} style={styles.agentHeader}>
				<View style={styles.flex}>
					<Body>{roleTitle(assignment.role)}</Body>
					<Muted>{providerTitle(assignment.provider)} · {assignment.model || '(未設定)'}</Muted>
				</View>
				<Text style={styles.link}>{open ? '閉じる' : '変更'}</Text>
			</Pressable>

			{open ? (
				<View style={styles.modelList}>
					{providers.length === 0 ? <Muted>選択できるモデルがありません。IDE 側でプロバイダーを設定してください。</Muted> : null}
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
											accessibilityState={{ selected }}
											onPress={() => {
												onChange({ ...assignment, provider: p.provider, model });
												setOpen(false);
											}}
											style={[styles.modelChip, selected && styles.modelChipSelected]}
										>
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
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		setName(project.name);
		setAgents(project.agents);
	}, [project]);

	const save = useCallback(async () => {
		setSaving(true);
		try {
			await onSave(name, agents);
		} finally {
			setSaving(false);
		}
	}, [name, agents, onSave]);

	return (
		<Modal animationType='slide' presentationStyle='pageSheet' onRequestClose={onClose}>
			<Screen>
				<View style={styles.modalHeader}>
					<Title>プロジェクトを編集</Title>
					<Pressable accessibilityRole='button' onPress={onClose}>
						<Text style={styles.link}>閉じる</Text>
					</Pressable>
				</View>

				<ScrollView contentContainerStyle={styles.content}>
					<Card>
						<SectionTitle>基本情報</SectionTitle>
						<Muted>プロジェクト名</Muted>
						<Input value={name} onChangeText={setName} placeholder='プロジェクト名' />
						<Muted>プロジェクト ID</Muted>
						<Body>{project.projectId || '(未設定)'}</Body>
					</Card>

					<Card>
						<SectionTitle>役割ごとのモデル</SectionTitle>
						<Muted>ここで割り当てたモデルが、Division API のオーケストレーションで使われます。</Muted>
						{agents.length === 0 ? <Muted>役割が登録されていません。</Muted> : null}
						{agents.map((a, idx) => (
							<AgentRow
								key={`${a.role}-${idx}`}
								assignment={a}
								providers={providers}
								onChange={next => setAgents(prev => prev.map((cur, i) => (i === idx ? next : cur)))}
							/>
						))}
					</Card>

					<Button title='保存' onPress={() => void save()} loading={saving} />
					<Button title='このプロジェクトを削除' variant='danger' onPress={() => void onDelete()} />
				</ScrollView>
			</Screen>
		</Modal>
	);
};

export const ProjectsScreen = () => {
	const { snapshot, error, refresh, isRefreshing, invalidate, client } = useApp();

	const [providers, setProviders] = useState<ProviderModels[]>([]);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const [newName, setNewName] = useState('');
	const [newId, setNewId] = useState('');
	const [syncing, setSyncing] = useState(false);

	const division = snapshot?.division ?? null;
	const editing = useMemo(
		() => division?.projects.find(p => p.projectId === editingId) ?? null,
		[division, editingId],
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

	const act = useCallback(async (fn: () => Promise<unknown>, successNote?: string) => {
		setNotice(null);
		try {
			await fn();
			if (successNote) setNotice(successNote);
			invalidate();
		} catch (e) {
			setNotice(e instanceof OrchestraApiError ? e.userMessage : String(e));
		}
	}, [invalidate]);

	if (!snapshot || !client || !division) {
		return (
			<Screen>
				{error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}
				<Loading label='プロジェクトを読み込んでいます…' />
			</Screen>
		);
	}

	return (
		<Screen>
			{error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}

			<ScrollView
				contentContainerStyle={styles.content}
				refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />}
			>
				<Card>
					<SectionTitle right={<Badge label={`${division.projects.length} 件`} />}>Division プロジェクト</SectionTitle>
					<Muted numberOfLines={1}>{division.configPath ?? 'ワークスペースが開かれていません'}</Muted>
					<Row>
						<Button
							title='Supabase から取得'
							variant='secondary'
							loading={syncing}
							onPress={() => {
								setSyncing(true);
								void act(() => client.pullProjectsFromSupabase(), '取得しました').finally(() => setSyncing(false));
							}}
							style={styles.flex}
						/>
						<Button
							title='Supabase へ送信'
							variant='secondary'
							loading={syncing}
							onPress={() => {
								setSyncing(true);
								void act(() => client.pushProjectsToSupabase(), '送信しました').finally(() => setSyncing(false));
							}}
							style={styles.flex}
						/>
					</Row>
				</Card>

				{division.projects.length === 0 ? (
					<EmptyState title='プロジェクトがありません' detail='下の「プロジェクトを追加」から作成できます。' />
				) : null}

				{division.projects.map(project => (
					<Card key={project.projectId || project.name}>
						<Row style={styles.spread}>
							<View style={styles.flex}>
								<Body numberOfLines={1}>{project.name}</Body>
								<Muted numberOfLines={1}>{project.projectId || 'ID 未設定'} · {project.agents.length} 役割</Muted>
							</View>
							{project.isActive ? <Badge label='有効' color={colors.success} /> : null}
						</Row>

						<View style={styles.agentPreview}>
							{project.agents.slice(0, 4).map((a, i) => (
								<Text key={`${a.role}-${i}`} style={styles.agentPreviewText} numberOfLines={1}>
									{roleTitle(a.role)} → {a.model || '(未設定)'}
								</Text>
							))}
							{project.agents.length > 4 ? <Muted>他 {project.agents.length - 4} 件</Muted> : null}
						</View>

						<Divider />

						<Row>
							<Button
								title={project.isActive ? 'このプロジェクトのみ有効' : '有効にする'}
								onPress={() => void act(() => client.activateProject(project.projectId, true), `${project.name} を有効にしました`)}
								style={styles.flex}
							/>
							<Button
								title={project.isActive ? '無効' : '併用'}
								variant='secondary'
								onPress={() => void act(() => client.activateProject(project.projectId, false))}
							/>
							<Button title='編集' variant='secondary' onPress={() => setEditingId(project.projectId)} />
						</Row>
					</Card>
				))}

				{adding ? (
					<Card>
						<SectionTitle>プロジェクトを追加</SectionTitle>
						<Input value={newName} onChangeText={setNewName} placeholder='プロジェクト名' />
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
										'追加しました',
									).then(() => {
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
					<Button title='プロジェクトを追加' variant='secondary' onPress={() => setAdding(true)} />
				)}

				{notice ? <Text style={styles.notice}>{notice}</Text> : null}
			</ScrollView>

			{editing ? (
				<ProjectEditor
					project={editing}
					providers={providers}
					onClose={() => setEditingId(null)}
					onSave={async (name, agents) => {
						await act(() => client.saveProject(editing.projectId, { name, agents }), '保存しました');
						setEditingId(null);
					}}
					onDelete={async () => {
						await act(() => client.deleteProject(editing.projectId), '削除しました');
						setEditingId(null);
					}}
				/>
			) : null}
		</Screen>
	);
};

const styles = StyleSheet.create({
	flex: { flex: 1 },
	spread: { justifyContent: 'space-between' },
	content: {
		padding: spacing.md,
		gap: spacing.md,
		paddingBottom: spacing.xl,
	},
	modalHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		padding: spacing.lg,
		borderBottomWidth: 1,
		borderBottomColor: colors.border,
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
		gap: spacing.sm,
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
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: 999,
		paddingHorizontal: spacing.sm + 2,
		paddingVertical: spacing.xs,
	},
	modelChipSelected: {
		borderColor: colors.accent,
		backgroundColor: '#12203a',
	},
	modelChipText: {
		color: colors.fgMuted,
		fontSize: fontSize.xs,
	},
	link: {
		color: colors.accent,
		fontSize: fontSize.xs,
		fontWeight: '600',
	},
	notice: {
		color: colors.fgMuted,
		fontSize: fontSize.xs,
		textAlign: 'center',
	},
});
