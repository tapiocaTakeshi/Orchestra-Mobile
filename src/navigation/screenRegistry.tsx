/**
 * ルート → 既存画面コンポーネントの登録先。
 * 既存画面は default / 名前付きエクスポートのどちらでも解決する。
 * 後続タスクは各 Screen ファイルを編集するだけでよく、ここは変更不要。
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as HomeModule from '../screens/HomeScreen';
import * as ProjectsModule from '../screens/ProjectsScreen';
import * as KanbanModule from '../screens/KanbanScreen';
import * as QuickActionsModule from '../screens/QuickActionsScreen';
import * as McpModule from '../screens/McpScreen';
import * as RemoteModule from '../screens/RemoteScreen';
import * as SettingsModule from '../screens/SettingsScreen';
import * as LoginModule from '../screens/LoginScreen';
import { colors, fontSize, space } from '../design/tokens';
import { RouteName, ROUTES } from './routes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ScreenComponent = React.ComponentType<any>;

function pickComponent(mod: unknown, exportName: string): ScreenComponent | null {
  const m = mod as Record<string, unknown>;
  const c = m.default ?? m[exportName];
  return typeof c === 'function' || (typeof c === 'object' && c !== null) ? (c as ScreenComponent) : null;
}

function placeholder(route: RouteName): ScreenComponent {
  const Placeholder = () => (
    <View style={styles.placeholder}>
      <Text style={styles.placeholderTitle}>{ROUTES[route].title}</Text>
      <Text style={styles.placeholderText}>この画面は準備中です（{ROUTES[route].owner}）</Text>
    </View>
  );
  Placeholder.displayName = `Placeholder_${route}`;
  return Placeholder;
}

const REGISTRY: Record<Exclude<RouteName, 'login'>, ScreenComponent> = {
  home: pickComponent(HomeModule, 'HomeScreen') ?? placeholder('home'),
  projects: pickComponent(ProjectsModule, 'ProjectsScreen') ?? placeholder('projects'),
  kanban: pickComponent(KanbanModule, 'KanbanScreen') ?? placeholder('kanban'),
  quick: pickComponent(QuickActionsModule, 'QuickActionsScreen') ?? placeholder('quick'),
  mcp: pickComponent(McpModule, 'McpScreen') ?? placeholder('mcp'),
  remote: pickComponent(RemoteModule, 'RemoteScreen') ?? placeholder('remote'),
  settings: pickComponent(SettingsModule, 'SettingsScreen') ?? placeholder('settings'),
};

/** 既存の LoginScreen（authAdapter が認証関数を見つけられない場合のフォールバック） */
export const LegacyLoginScreen: ScreenComponent | null = pickComponent(LoginModule, 'LoginScreen');

export function getScreenComponent(route: Exclude<RouteName, 'login'>): ScreenComponent {
  return REGISTRY[route];
}

const styles = StyleSheet.create({
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm },
  placeholderTitle: { fontSize: fontSize.title, fontWeight: '600', color: colors.fgStrong },
  placeholderText: { fontSize: fontSize.small, color: colors.fgMuted, textAlign: 'center' },
});
