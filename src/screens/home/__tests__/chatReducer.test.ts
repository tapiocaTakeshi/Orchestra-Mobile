import { chatReducer, initialChatState, isSending } from '../chatReducer';
import { createDemoChatBackend } from '../demoChatBackend';
import type { ChatState } from '../chatReducer';

async function loadedState(): Promise<ChatState> {
  const snapshot = await createDemoChatBackend({ delayMs: 0 }).loadInitial();
  return chatReducer(initialChatState, { type: 'loaded', snapshot });
}

describe('chatReducer', () => {
  it('デモの初期状態にモックアップの承認待ちが含まれる', async () => {
    const s = await loadedState();
    expect(s.loaded).toBe(true);
    expect(s.approval?.summary).toBe('jest のスナップショットを更新');
    expect(s.title).toBe('配色を Claude 風に整える');
  });

  it('送信で処理中ターンが追加され、返答で完了になる', async () => {
    let s = await loadedState();
    s = chatReducer(s, { type: 'userSent', userId: 'u', agentId: 'a', text: 'テスト' });
    expect(isSending(s)).toBe(true);
    s = chatReducer(s, { type: 'agentReplied', agentId: 'a', reply: { paragraphs: ['ok'], toolLines: [] } });
    expect(isSending(s)).toBe(false);
    const a = s.items.find((i) => i.id === 'a');
    expect(a && a.kind === 'agent' && a.status).toBe('done');
  });

  it('許可で承認帯が消え、対象ターンが完了になる', async () => {
    let s = await loadedState();
    s = chatReducer(s, { type: 'approvalStarted' });
    expect(s.resolvingApproval).toBe(true);
    s = chatReducer(s, { type: 'approvalResolved', decision: 'approve' });
    expect(s.approval).toBeNull();
    const t = s.items.find((i) => i.id === 'demo-a2');
    expect(t && t.kind === 'agent' && t.status).toBe('done');
  });

  it('拒否で対象ターンが拒否になる', async () => {
    let s = await loadedState();
    s = chatReducer(s, { type: 'approvalResolved', decision: 'deny' });
    const t = s.items.find((i) => i.id === 'demo-a2');
    expect(t && t.kind === 'agent' && t.status).toBe('denied');
  });

  it('承認送信に失敗したら承認帯は残る', async () => {
    let s = await loadedState();
    s = chatReducer(s, { type: 'approvalStarted' });
    s = chatReducer(s, { type: 'approvalFailed' });
    expect(s.approval).not.toBeNull();
    expect(s.resolvingApproval).toBe(false);
  });

  it('送信失敗はエラー表示になる', async () => {
    let s = await loadedState();
    s = chatReducer(s, { type: 'userSent', userId: 'u', agentId: 'a', text: 'x' });
    s = chatReducer(s, { type: 'agentFailed', agentId: 'a', message: '失敗' });
    const a = s.items.find((i) => i.id === 'a');
    expect(a && a.kind === 'agent' && a.status).toBe('error');
  });

  it('モデル変更', () => {
    const s = chatReducer(initialChatState, { type: 'modelChanged', model: 'Haiku' });
    expect(s.model).toBe('Haiku');
  });

  it('デモバックエンドは isDemo かつ未対応操作を明示する', () => {
    const b = createDemoChatBackend();
    expect(b.isDemo).toBe(true);
    expect(b.capabilities).toEqual({ runtimeSwitch: false, repoPicker: false, newChat: false });
  });
});
