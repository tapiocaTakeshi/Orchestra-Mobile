import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { color, radius, shadow, space } from '../../design/tokens';
import { fonts as font } from '../../design/theme';
import { setSelectedProject, useSelectedProject } from '../../lib/selectedProject';
import { metaLeft, ProjectItem, ProjectStatus, STATUS_LABEL } from './projectModel';
import { defaultLoadProjects, notifyLibSelection, useProjects } from './useProjects';

type Nav = { navigate?: (route: string, params?: object) => void; goBack?: () => void; canGoBack?: () => boolean };

export type ProjectsViewProps = {
  navigation?: Nav;
  /** テストや別データ源の差し込み用。未指定なら既存 divisionProjects を使う */
  loadProjects?: () => Promise<unknown>;
  onBack?: () => void;
  onStartSession?: (p: ProjectItem) => void;
  onOpenKanban?: (p: ProjectItem) => void;
  onAddRepository?: () => void;
  homeRoute?: string;
  kanbanRoute?: string;
};

const DOT: Record<ProjectStatus, string> = {
  running: color.running,
  warning: color.warning,
  success: color.success,
  danger: color.danger,
};

function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback(
    (m: string) => {
      setMsg(m);
      Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setMsg(null));
      }, 1800);
    },
    [anim],
  );
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return { msg, anim, show };
}

function Badge({ status }: { status: ProjectStatus }) {
  return (
    <View style={styles.badge} accessibilityLabel={`状態: ${STATUS_LABEL[status]}`}>
      <View style={[styles.dot, { backgroundColor: DOT[status] }]} />
      <Text style={styles.badgeText}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}

export function ProjectsView(props: ProjectsViewProps) {
  const { navigation, homeRoute = 'Home', kanbanRoute = 'Kanban' } = props;
  const loader = props.loadProjects ?? defaultLoadProjects;
  const { projects, loading, error, reload } = useProjects(loader);
  const selected = useSelectedProject();
  const [query, setQuery] = useState('');
  const toast = useToast();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q) || p.repo.toLowerCase().includes(q));
  }, [projects, query]);

  // 未選択なら先頭を選択状態にする（モックアップでは先頭カードに操作ボタンが出ている）
  useEffect(() => {
    if (!selected && projects.length > 0) {
      const p = projects[0];
      setSelectedProject({ id: p.id, name: p.name, repo: p.repo, branch: p.branch });
    }
  }, [projects, selected]);

  const select = (p: ProjectItem) => {
    setSelectedProject({ id: p.id, name: p.name, repo: p.repo, branch: p.branch });
    notifyLibSelection(p.id);
  };

  const back = () => {
    if (props.onBack) return props.onBack();
    if (navigation?.canGoBack?.() && navigation.goBack) return navigation.goBack();
    navigation?.navigate?.(homeRoute);
  };

  const startSession = (p: ProjectItem) => {
    select(p);
    if (props.onStartSession) props.onStartSession(p);
    else navigation?.navigate?.(homeRoute, { projectId: p.id });
    toast.show('新しいセッションを起動しました');
  };

  const openKanban = (p: ProjectItem) => {
    select(p);
    if (props.onOpenKanban) props.onOpenKanban(p);
    else navigation?.navigate?.(kanbanRoute, { projectId: p.id });
  };

  const addRepository = () => {
    if (props.onAddRepository) props.onAddRepository();
    else toast.show('GitHub リポジトリの選択');
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="戻る"
          onPress={back}
          style={({ pressed }) => [styles.iconBtn, pressed && { backgroundColor: color.bgHover }]}
        >
          <Text style={styles.iconText}>←</Text>
        </Pressable>
        <Text style={styles.pageTitle} numberOfLines={1}>
          プロジェクト
        </Text>
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.input}
          placeholder="プロジェクトを検索"
          placeholderTextColor={color.fgFaint}
          accessibilityLabel="検索"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={styles.stack}>
          {loading ? (
            <View style={[styles.card, styles.center]} testID="projects-loading">
              <ActivityIndicator color={color.accent} />
              <Text style={[styles.muted, { marginTop: space.sm }]}>プロジェクトを読み込み中…</Text>
            </View>
          ) : error ? (
            <View style={styles.card} testID="projects-error">
              <View style={styles.listRow}>
                <View style={[styles.dot, { backgroundColor: color.danger }]} />
                <Text style={styles.rowH}>プロジェクトを取得できませんでした</Text>
              </View>
              <Text style={[styles.muted, { marginTop: space.sm }]}>{error}</Text>
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" onPress={reload} style={({ pressed }) => [styles.btnSm, styles.btnSecondary, pressed && { backgroundColor: color.bgHover }]}>
                  <Text style={styles.btnSecondaryText}>再読み込み</Text>
                </Pressable>
              </View>
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.card} testID="projects-empty">
              <Text style={styles.rowH}>{query.trim() ? '一致するプロジェクトはありません' : 'プロジェクトがありません'}</Text>
              <Text style={[styles.muted, { marginTop: space.xs }]}>
                {query.trim() ? '検索語を変えてお試しください。' : 'GitHub リポジトリを追加すると、ここに表示されます。'}
              </Text>
            </View>
          ) : (
            filtered.map((p) => {
              const isSelected = selected?.id === p.id;
              return (
                <Pressable
                  key={p.id}
                  testID={`project-card-${p.id}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${p.name}、${STATUS_LABEL[p.status]}`}
                  onPress={() => select(p)}
                  style={styles.card}
                >
                  <View style={styles.listRow}>
                    <View style={styles.grow}>
                      <Text style={styles.rowH} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text style={styles.muted} numberOfLines={1}>
                        {p.repo}
                      </Text>
                    </View>
                    <Badge status={p.status} />
                  </View>
                  <View style={styles.metaLine}>
                    <Text style={styles.captionMono}>{metaLeft(p)}</Text>
                    {p.updatedLabel ? <Text style={styles.captionMono}>{p.updatedLabel}</Text> : null}
                  </View>
                  {isSelected ? (
                    <View style={styles.actions}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => startSession(p)}
                        style={({ pressed }) => [styles.btnSm, { backgroundColor: pressed ? color.accentPressed : color.accent }]}
                      >
                        <Text style={styles.btnPrimaryText}>セッションを起動</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => openKanban(p)}
                        style={({ pressed }) => [styles.btnSm, styles.btnSecondary, pressed && { backgroundColor: color.bgHover }]}
                      >
                        <Text style={styles.btnSecondaryText}>カンバン</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </Pressable>
              );
            })
          )}

          {!loading && !error ? (
            <Pressable
              accessibilityRole="button"
              onPress={addRepository}
              style={({ pressed }) => [styles.btn, styles.btnSecondary, pressed && { backgroundColor: color.bgHover }]}
            >
              <Text style={[styles.btnSecondaryText, { fontSize: 15 }]}>＋ リポジトリを追加</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      {toast.msg ? (
        <Animated.View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={[
            styles.toast,
            {
              opacity: toast.anim,
              transform: [{ translateY: toast.anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
            },
          ]}
        >
          <Text style={styles.toastText}>{toast.msg}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  iconBtn: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 20, color: color.fgStrong },
  pageTitle: { flex: 1, fontFamily: font.serif, fontSize: 22, fontWeight: '500', color: color.fgStrong, lineHeight: 29 },
  content: { paddingTop: space.lg, paddingHorizontal: space.md, paddingBottom: space.xl },
  input: {
    minHeight: 44,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.bgInput,
    color: color.fg,
    fontSize: 15,
    fontFamily: font.body,
    marginBottom: space.lg,
  },
  stack: { gap: space.md },
  card: {
    backgroundColor: color.bgElevated,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: space.lg,
    ...shadow[1],
  },
  center: { alignItems: 'center' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  grow: { flex: 1, minWidth: 0 },
  rowH: { fontSize: 15, fontWeight: '600', color: color.fgStrong, lineHeight: 21 },
  muted: { fontSize: 13, color: color.fgMuted, lineHeight: 18 },
  metaLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  captionMono: { fontFamily: font.mono, fontSize: 12, color: color.fgFaint },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.bgElevated,
  },
  badgeText: { fontSize: 12, fontWeight: '600', color: color.fgMuted },
  dot: { width: 8, height: 8, borderRadius: 4 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md, flexWrap: 'wrap' },
  btn: {
    minHeight: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  btnSm: {
    minHeight: 36,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  btnSecondary: { backgroundColor: color.bgElevated, borderColor: color.borderStrong },
  btnPrimaryText: { color: color.onAccent, fontSize: 13, fontWeight: '600' },
  btnSecondaryText: { color: color.fgStrong, fontSize: 13, fontWeight: '600' },
  toast: {
    position: 'absolute',
    bottom: space['2xl'],
    alignSelf: 'center',
    backgroundColor: color.fgStrong,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    ...shadow[3],
  },
  toastText: { color: color.bg, fontSize: 13, fontWeight: '600' },
});

export default ProjectsView;
