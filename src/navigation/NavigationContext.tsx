import React, { createContext, useContext } from 'react';
import { RouteName, toRouteName } from './routes';

export interface AppNavigation {
  route: RouteName;
  canGoBack: boolean;
  navigate: (to: RouteName) => void;
  replace: (to: RouteName) => void;
  reset: (to: RouteName) => void;
  selectFromDrawer: (to: RouteName) => void;
  goBack: () => boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  toast: (message: string) => void;
  signOut: () => void;
}

const Ctx = createContext<AppNavigation | null>(null);

export const AppNavigationProvider = Ctx.Provider;

export function useAppNavigation(): AppNavigation {
  const nav = useContext(Ctx);
  if (!nav) throw new Error('useAppNavigation は OrchestraApp の内側で使ってください');
  return nav;
}

/**
 * 既存画面（react-navigation の navigation prop を想定している可能性がある）向けの互換オブジェクト。
 * 未知の画面名は無視して false を返すだけで、例外は投げない。
 */
export function createLegacyNavigation(nav: AppNavigation) {
  const resolve = (name: unknown): RouteName | null => (typeof name === 'string' ? toRouteName(name) : null);
  return {
    navigate: (name: unknown) => {
      const r = resolve(typeof name === 'object' && name ? (name as { name?: unknown }).name : name);
      if (r) nav.navigate(r);
    },
    push: (name: unknown) => {
      const r = resolve(name);
      if (r) nav.navigate(r);
    },
    replace: (name: unknown) => {
      const r = resolve(name);
      if (r) nav.replace(r);
    },
    reset: (state: unknown) => {
      const routes = (state as { routes?: { name?: unknown }[] } | null)?.routes;
      const last = routes && routes.length ? routes[routes.length - 1].name : undefined;
      const r = resolve(last);
      if (r) nav.reset(r);
    },
    goBack: () => {
      nav.goBack();
    },
    canGoBack: () => nav.canGoBack,
    openDrawer: nav.openDrawer,
    closeDrawer: nav.closeDrawer,
    toggleDrawer: nav.toggleDrawer,
    setOptions: () => undefined,
    setParams: () => undefined,
    dispatch: () => undefined,
    isFocused: () => true,
    addListener: () => () => undefined,
    removeListener: () => undefined,
    getParent: () => undefined,
  };
}

export type LegacyNavigation = ReturnType<typeof createLegacyNavigation>;

export function AppNavigationBoundary({ value, children }: { value: AppNavigation; children: React.ReactNode }) {
  return <AppNavigationProvider value={value}>{children}</AppNavigationProvider>;
}
