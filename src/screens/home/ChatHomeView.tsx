import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { createDemoChatBackend } from './demoChatBackend';
import { color, font, radius, shadow, space } from './homeTokens';
import { useChatController } from './useChatController';
import { MODEL_OPTIONS, type AgentItem, type AgentStatus, type ChatBackend } from './chatTypes';

export type HomeNavTarget = 'home' | 'projects' | 'kanban' | 'quick' | 'mcp' | 'remote' | 'login';

export interface ChatHomeViewProps {
  /** 未指定時はデモ用バックエンド（通信なし） */
  backend?: ChatBackend;
  onNavigate?: (target: HomeNavTarget) => void;
  onLogout?: () => void;
  accountName?: string;
  accountEmail?: string;
}

const STATUS: Record<AgentStatus, { label: string; dot: string }> = {
  running: { label: '作業中', dot: color.running },
  awaiting: { label: '承認待ち', dot: color.warning },
  done: { label: '完了', dot: color.success },
  denied: { label: '拒否', dot: color.danger },
  error: { label: 'エラー', dot: color.danger },
};

const NAV: { target: HomeNavTarget; icon: string; label: string }[] = [
  { target: 'home', icon: '💬', label: '会話' },
  { target: 'projects', icon: '📁', label: 'プロジェクト' },
  { target: 'kanban', icon: '▦', label: 'カンバン' },
  { target: 'quick', icon: '⚡', label: 'クイックアクション' },
  { target: 'mcp', icon: '⛓', label: 'MCP サーバー' },
  { target: 'remote', icon: '📡', label: 'リモート接続' },
];

const UNAVAILABLE = 'この操作はまだ利用できません';

function Dot({ c }: { c: string }) {
  return <View style={[styles.dot, { backgroundColor: c }]} />;
}

function Badge({ status }: { status: AgentStatus }) {
  const s = STATUS[status];
  return (
    <View style={styles.badge} accessibilityLabel={s.label}>
      <Dot c={s.dot} />
      <Text style={styles.badgeText}>{s.label}</Text>
    </View>
  );
}

function AgentTurn({ item }: { item: AgentItem }) {
  return (
    <View style={styles.agentTurn}>
      <View style={styles.agentHead}>
        <View style={styles.avatar}><Text style={styles.avatarText}>✻</Text></View>
        <Text style={styles.agentName}>エージェント</Text>
        <Badge status={item.status} />
      </View>
      <View style={styles.agentBody}>
        {item.paragraphs.map((p, i) => (
          <Text key={`p${i}`} style={styles.agentText}>{p}</Text>
        ))}
        {item.toolLines.map((t, i) => (
          <Text key={`t${i}`} style={styles.toolLine}>{t}</Text>
        ))}
        {item.code ? (
          <ScrollView horizontal style={styles.code} showsHorizontalScrollIndicator={false}>
            <Text style={styles.codeText}>{item.code}</Text>
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

export default function ChatHomeView({
  backend: backendProp,
  onNavigate,
  onLogout,
  accountName = 'Kenta',
  accountEmail = 'kenta@example.com',
}: ChatHomeViewProps) {
  const backend = useMemo(() => backendProp ?? createDemoChatBackend(), [backendProp]);
  const { state, toastMessage, toast, send, approve, deny, changeModel } = useChatController(backend);

  const [draft, setDraft] = useState('');
  const [inputHeight, setInputHeight] = useState(44);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(toastAnim, { toValue: toastMessage ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [toastMessage, toastAnim]);

  const canSend = draft.trim().length > 0;

  const handleSend = () => {
    if (!canSend) return;
    const text = draft;
    setDraft('');
    setInputHeight(44);
    void send(text);
  };

  const navigate = (target: HomeNavTarget) => {
    setDrawerOpen(false);
    if (target === 'home') return;
    if (onNavigate) onNavigate(target);
    else toast(UNAVAILABLE);
  };

  const logout = () => {
    setDrawerOpen(false);
    if (onLogout) onLogout();
    else if (onNavigate) onNavigate('login');
    toast('ログアウトしました');
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <Pressable style={styles.iconBtn} onPress={() => setDrawerOpen(true)} accessibilityRole="button" accessibilityLabel="メニューを開く">
            <Text style={styles.iconText}>☰</Text>
          </Pressable>
          <View style={styles.headerTitle}>
            <Text style={styles.headerTitleText} numberOfLines={1}>{state.title || '会話'}</Text>
            <View style={styles.headerSub}>
              <Dot c={state.connected ? color.success : color.danger} />
              <Text style={styles.headerSubText} numberOfLines={1}>
                {state.connectionLabel || (state.loaded ? '未接続' : '読み込み中…')}
              </Text>
            </View>
          </View>
          <Pressable
            style={styles.iconBtn}
            onPress={() => toast(backend.capabilities.newChat ? '新しい会話を開始しました' : UNAVAILABLE)}
            accessibilityRole="button"
            accessibilityLabel="新しい会話"
          >
            <Text style={styles.iconText}>✎</Text>
          </Pressable>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {state.items.map((item) => {
            if (item.kind === 'day') return <Text key={item.id} style={styles.day}>{item.label}</Text>;
            if (item.kind === 'user')
              return (
                <View key={item.id} style={styles.userWrap}>
                  <View style={styles.userBubble}><Text style={styles.userText}>{item.text}</Text></View>
                </View>
              );
            return <AgentTurn key={item.id} item={item} />;
          })}
        </ScrollView>

        {state.approval ? (
          <View style={styles.approval} testID="approvalBar">
            <Dot c={color.warning} />
            <Text style={styles.approvalText} numberOfLines={2}>
              <Text style={styles.approvalStrong}>承認待ち 1 件</Text> · {state.approval.summary}
            </Text>
            <Pressable style={[styles.btnSm, styles.btnSecondary]} onPress={deny} disabled={state.resolvingApproval} accessibilityRole="button">
              <Text style={styles.btnSecondaryText}>拒否</Text>
            </Pressable>
            <Pressable style={[styles.btnSm, styles.btnPrimary]} onPress={approve} disabled={state.resolvingApproval} accessibilityRole="button">
              <Text style={styles.btnPrimaryText}>許可</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.composerWrap}>
          <View style={styles.composer}>
            <TextInput
              style={[styles.input, { height: inputHeight }]}
              value={draft}
              onChangeText={setDraft}
              multiline
              placeholder="エージェントに頼みたいことを書く…"
              placeholderTextColor={color.fgFaint}
              accessibilityLabel="メッセージ"
              onContentSizeChange={(e) => setInputHeight(Math.max(44, Math.min(160, e.nativeEvent.contentSize.height + 16)))}
              scrollEnabled={inputHeight >= 160}
            />
            <View style={styles.bar}>
              <ScrollView horizontal style={styles.chipset} contentContainerStyle={styles.chipsetInner} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Pressable style={styles.chip} onPress={() => toast(backend.capabilities.runtimeSwitch ? '実行先を切り替えます' : UNAVAILABLE)}>
                  <Text style={styles.chipText}>☁ クラウド ▾</Text>
                </Pressable>
                <Pressable style={styles.chip} onPress={() => toast(backend.capabilities.repoPicker ? 'リポジトリを選択します' : UNAVAILABLE)}>
                  <Text style={styles.chipText}>⑂ {backend.repoLabel} ▾</Text>
                </Pressable>
                <Pressable style={styles.chip} onPress={() => setSheetOpen(true)} accessibilityLabel="モデルを選ぶ">
                  <Text style={styles.chipText}>⚙ {state.model} ▾</Text>
                </Pressable>
                {state.costLabel ? (
                  <Pressable style={styles.chip} onPress={() => toast(`今日のコスト: ${state.costLabel}`)}>
                    <Text style={styles.chipText}>📊 {state.costLabel}</Text>
                  </Pressable>
                ) : null}
              </ScrollView>
              <Pressable
                style={[styles.send, !canSend && styles.disabled]}
                onPress={handleSend}
                disabled={!canSend}
                accessibilityRole="button"
                accessibilityLabel="送信"
                accessibilityState={{ disabled: !canSend }}
              >
                <Text style={styles.sendText}>↑</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Drawer */}
      <Modal visible={drawerOpen} transparent animationType="fade" onRequestClose={() => setDrawerOpen(false)}>
        <View style={styles.layer}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setDrawerOpen(false)} accessibilityLabel="閉じる">
            <View style={styles.scrim} />
          </Pressable>
          <View style={styles.drawer} accessibilityLabel="ナビゲーション">
            <View style={styles.drawerBrand}>
              <View style={styles.avatar}><Text style={styles.avatarText}>✻</Text></View>
              <Text style={styles.drawerBrandText}>Orchestra</Text>
            </View>
            <ScrollView style={styles.flex}>
              {NAV.map((n) => {
                const current = n.target === 'home';
                return (
                  <Pressable key={n.target} style={[styles.navItem, current && styles.navItemCurrent]} onPress={() => navigate(n.target)} accessibilityRole="button">
                    <Text style={[styles.navIc, current && { color: color.accentText }]}>{n.icon}</Text>
                    <Text style={[styles.navText, current && { color: color.fgStrong }]}>{n.label}</Text>
                  </Pressable>
                );
              })}
              <Text style={styles.navLabel}>最近の会話</Text>
              {state.recentTitles.map((t) => (
                <Pressable key={t} style={styles.recent} onPress={() => setDrawerOpen(false)}>
                  <Text style={styles.recentText} numberOfLines={1}>{t}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.account}>
              <View style={styles.accountAv}><Text style={styles.accountAvText}>{accountName.slice(0, 1).toUpperCase()}</Text></View>
              <View style={styles.flexShrink}>
                <Text style={styles.accountName}>{accountName}</Text>
                <Text style={styles.caption} numberOfLines={1}>{accountEmail}</Text>
              </View>
              <Pressable style={styles.btnSm} onPress={logout} accessibilityRole="button">
                <Text style={styles.btnGhostText}>ログアウト</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Model sheet */}
      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <View style={styles.layer}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSheetOpen(false)} accessibilityLabel="閉じる">
            <View style={styles.scrim} />
          </Pressable>
          <View style={styles.sheet} accessibilityLabel="モデルを選ぶ">
            <View style={styles.grabber} />
            <Text style={styles.sheetTitle}>モデルを選ぶ</Text>
            {MODEL_OPTIONS.map((o) => {
              const checked = o.model === state.model;
              return (
                <Pressable
                  key={o.model}
                  style={[styles.option, checked && { borderColor: color.accentText }]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked }}
                  onPress={() => {
                    setSheetOpen(false);
                    if (!checked) void changeModel(o.model);
                  }}
                >
                  <View style={styles.flexShrink}>
                    <Text style={styles.rowH}>{o.model}</Text>
                    <Text style={styles.muted}>{o.description}</Text>
                  </View>
                  <Text style={[styles.check, !checked && { opacity: 0 }]}>✓</Text>
                </Pressable>
              );
            })}
            <Pressable style={[styles.btn, styles.btnSecondary]} onPress={() => setSheetOpen(false)} accessibilityRole="button">
              <Text style={styles.btnSecondaryTextLg}>閉じる</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Animated.View
        pointerEvents="none"
        style={[styles.toast, { opacity: toastAnim, transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }]}
        accessibilityLiveRegion="polite"
      >
        <Text style={styles.toastText} numberOfLines={1}>{toastMessage ?? ''}</Text>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  flexShrink: { flex: 1, minWidth: 0 },

  header: { height: 56, flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.xs, borderBottomWidth: 1, borderBottomColor: color.border },
  iconBtn: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 20, color: color.fgStrong },
  headerTitle: { flex: 1, minWidth: 0 },
  headerTitleText: { fontSize: 17, fontWeight: '600', color: color.fgStrong, lineHeight: 22 },
  headerSub: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerSubText: { fontSize: 12, color: color.fgFaint, lineHeight: 17, flexShrink: 1 },

  content: { paddingTop: space.lg, paddingHorizontal: space.md, paddingBottom: space.xl, gap: space.lg },
  day: { alignSelf: 'center', fontFamily: font.mono, fontSize: 12, color: color.fgFaint },
  userWrap: { flexDirection: 'row', justifyContent: 'flex-end', paddingLeft: space.xxl },
  userBubble: { backgroundColor: color.bgHover, borderRadius: 20, borderBottomRightRadius: 6, paddingVertical: 10, paddingHorizontal: 14, maxWidth: '100%' },
  userText: { color: color.fg, fontSize: 15, lineHeight: 22 },

  agentTurn: { gap: space.sm },
  agentHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  avatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: color.accentTint, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: color.accent, fontSize: 14 },
  agentName: { color: color.fgMuted, fontSize: 13, fontWeight: '600' },
  agentBody: { paddingLeft: 34, gap: space.sm },
  agentText: { fontSize: 15, lineHeight: 23, color: color.fg },
  toolLine: { fontFamily: font.mono, fontSize: 12, lineHeight: 18, color: color.fgFaint },
  code: { backgroundColor: color.bgElevated, borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, paddingVertical: space.sm, paddingHorizontal: space.md },
  codeText: { fontFamily: font.mono, fontSize: 12, lineHeight: 18, color: color.fgStrong },

  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 22, paddingHorizontal: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: color.border, backgroundColor: color.bgElevated },
  badgeText: { fontSize: 12, fontWeight: '600', color: color.fgMuted },
  dot: { width: 8, height: 8, borderRadius: 4 },

  approval: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, paddingHorizontal: space.md, backgroundColor: color.bgSidebar, borderTopWidth: 1, borderTopColor: color.border },
  approvalText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18, color: color.fg },
  approvalStrong: { color: color.fgStrong, fontWeight: '600' },

  btn: { minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  btnSm: { minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  btnPrimary: { backgroundColor: color.accent },
  btnPrimaryText: { color: color.onAccent, fontSize: 13, fontWeight: '600' },
  btnSecondary: { backgroundColor: color.bgElevated, borderColor: color.borderStrong },
  btnSecondaryText: { color: color.fgStrong, fontSize: 13, fontWeight: '600' },
  btnSecondaryTextLg: { color: color.fgStrong, fontSize: 15, fontWeight: '600' },
  btnGhostText: { color: color.accentText, fontSize: 13, fontWeight: '600' },

  composerWrap: { paddingTop: space.sm, paddingHorizontal: space.md, paddingBottom: space.md, backgroundColor: color.bg },
  composer: { backgroundColor: color.bgElevated, borderWidth: 1, borderColor: color.border, borderRadius: radius.xl, paddingVertical: space.sm, paddingRight: space.sm, paddingLeft: space.md, ...shadow.s2 },
  input: { minHeight: 44, maxHeight: 160, color: color.fg, fontSize: 15, lineHeight: 21, paddingVertical: space.sm, paddingHorizontal: 0, textAlignVertical: 'top' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chipset: { flex: 1, minWidth: 0 },
  chipsetInner: { gap: 6, alignItems: 'center' },
  chip: { height: 28, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: color.border, backgroundColor: color.bg, justifyContent: 'center' },
  chipText: { fontFamily: font.mono, fontSize: 12, color: color.fgMuted },
  send: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: color.onAccent, fontSize: 17, fontWeight: '700' },
  disabled: { opacity: 0.4 },

  layer: { flex: 1 },
  scrim: { flex: 1, backgroundColor: color.scrim },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 300, maxWidth: '85%', backgroundColor: color.bgSidebar, paddingTop: 44, paddingHorizontal: space.md, paddingBottom: space.lg },
  drawerBrand: { flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 56, paddingHorizontal: space.sm },
  drawerBrandText: { fontFamily: font.serif, fontSize: 22, fontWeight: '500', color: color.fgStrong },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, height: 48, paddingHorizontal: space.md, borderRadius: radius.md, marginTop: 2 },
  navItemCurrent: { backgroundColor: color.bgHover },
  navIc: { width: 20, textAlign: 'center', fontSize: 18, color: color.fgMuted },
  navText: { fontSize: 15, fontWeight: '500', color: color.fg },
  navLabel: { fontSize: 12, color: color.fgFaint, paddingTop: space.lg, paddingHorizontal: space.md, paddingBottom: space.xs },
  recent: { paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.sm },
  recentText: { fontSize: 13, color: color.fgMuted },
  account: { borderTopWidth: 1, borderTopColor: color.border, paddingTop: space.md, flexDirection: 'row', alignItems: 'center', gap: space.md },
  accountAv: { width: 36, height: 36, borderRadius: 18, backgroundColor: color.bgHover, alignItems: 'center', justifyContent: 'center' },
  accountAvText: { fontWeight: '600', color: color.fgStrong, fontSize: 15 },
  accountName: { fontSize: 15, fontWeight: '600', color: color.fgStrong },
  caption: { fontSize: 12, color: color.fgFaint },

  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: color.bgElevated, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: space.sm, paddingHorizontal: space.lg, paddingBottom: space.xl, ...shadow.s3 },
  grabber: { width: 36, height: 5, borderRadius: radius.pill, backgroundColor: color.borderStrong, alignSelf: 'center', marginBottom: space.md },
  sheetTitle: { fontFamily: font.serif, fontSize: 22, fontWeight: '500', color: color.fgStrong, marginBottom: space.md },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: space.sm, paddingHorizontal: space.md, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, marginBottom: space.sm },
  rowH: { fontSize: 15, fontWeight: '600', color: color.fgStrong },
  muted: { fontSize: 13, lineHeight: 18, color: color.fgMuted },
  check: { color: color.accentText, fontWeight: '700', fontSize: 15 },

  toast: { position: 'absolute', alignSelf: 'center', bottom: space.xxl, backgroundColor: color.fgStrong, paddingVertical: space.sm, paddingHorizontal: space.lg, borderRadius: radius.pill, maxWidth: '90%', ...shadow.s3 },
  toastText: { color: color.bg, fontSize: 13, fontWeight: '600' },
});
