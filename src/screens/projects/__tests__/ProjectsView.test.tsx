/**
 * @jest-environment jsdom
 */
import React from 'react';
import { act, fireEvent as domFireEvent, render, waitFor } from '@testing-library/react';

// jest では react-native を react-native-web に差し替えているため、DOM 版 Testing Library で検証する。
// RN の press / changeText を DOM のイベントに対応付ける。
const fireEvent = {
  press: (el: HTMLElement) => domFireEvent.click(el),
  changeText: (el: HTMLElement, value: string) => domFireEvent.change(el, { target: { value } }),
};
import { ProjectsView } from '../ProjectsView';
import { getSelectedProject, setSelectedProject } from '../../../lib/selectedProject';

const raw = [
  { id: 'a', name: 'orchestra-mobile', repo: 'https://github.com/division/orchestra-mobile', branch: 'main', sessionCount: 3, status: 'running' },
  { id: 'b', name: 'division-relay', repo: 'github.com/division/division-relay', branch: 'feat/codec', sessionCount: 1, status: 'pending' },
];

describe('ProjectsView', () => {
  beforeEach(() => {
    setSelectedProject(null);
  });

  it('モックアップの文言とカードを表示する', async () => {
    const r = render(<ProjectsView loadProjects={() => Promise.resolve(raw)} />);
    expect(r.getByText('プロジェクト')).toBeTruthy();
    expect(r.getByPlaceholderText('プロジェクトを検索')).toBeTruthy();
    await waitFor(() => expect(r.getByText('orchestra-mobile')).toBeTruthy());
    expect(r.getByText('github.com/division/orchestra-mobile')).toBeTruthy();
    expect(r.getByText('作業中')).toBeTruthy();
    expect(r.getByText('承認待ち')).toBeTruthy();
    expect(r.getByText('main · 3 セッション')).toBeTruthy();
    expect(r.getByText('＋ リポジトリを追加')).toBeTruthy();
    // 先頭が選択され、操作ボタンが出る
    expect(r.getByText('セッションを起動')).toBeTruthy();
    expect(r.getByText('カンバン')).toBeTruthy();
  });

  it('カード選択を共有ストアに保存し、遷移先へ引き継ぐ', async () => {
    const navigate = jest.fn();
    const r = render(<ProjectsView navigation={{ navigate }} loadProjects={() => Promise.resolve(raw)} />);
    await waitFor(() => expect(r.getByText('division-relay')).toBeTruthy());
    fireEvent.press(r.getByTestId('project-card-b'));
    expect(getSelectedProject()?.id).toBe('b');
    fireEvent.press(r.getByText('カンバン'));
    expect(navigate).toHaveBeenCalledWith('Kanban', { projectId: 'b' });
    fireEvent.press(r.getByText('セッションを起動'));
    expect(navigate).toHaveBeenCalledWith('Home', { projectId: 'b' });
  });

  it('検索で絞り込み、0 件時は空表示', async () => {
    const r = render(<ProjectsView loadProjects={() => Promise.resolve(raw)} />);
    await waitFor(() => expect(r.getByText('orchestra-mobile')).toBeTruthy());
    fireEvent.changeText(r.getByPlaceholderText('プロジェクトを検索'), 'relay');
    expect(r.queryByText('orchestra-mobile')).toBeNull();
    fireEvent.changeText(r.getByPlaceholderText('プロジェクトを検索'), 'zzz');
    expect(r.getByText('一致するプロジェクトはありません')).toBeTruthy();
  });

  it('エラー時に再読み込みできる', async () => {
    const loader = jest.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(raw);
    const r = render(<ProjectsView loadProjects={loader} />);
    await waitFor(() => expect(r.getByTestId('projects-error')).toBeTruthy());
    await act(async () => {
      fireEvent.press(r.getByText('再読み込み'));
    });
    await waitFor(() => expect(r.getByText('orchestra-mobile')).toBeTruthy());
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
