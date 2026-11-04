import { useSyncExternalStore } from 'react';

export type SelectedProject = {
  id: string;
  name: string;
  repo: string;
  branch?: string;
};

let current: SelectedProject | null = null;
const listeners = new Set<() => void>();

export function getSelectedProject(): SelectedProject | null {
  return current;
}

export function setSelectedProject(next: SelectedProject | null): void {
  current = next;
  listeners.forEach((l) => l());
}

export function subscribeSelectedProject(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** ホーム・カンバンなど関連画面から選択中プロジェクトを読む */
export function useSelectedProject(): SelectedProject | null {
  return useSyncExternalStore(subscribeSelectedProject, getSelectedProject, getSelectedProject);
}
