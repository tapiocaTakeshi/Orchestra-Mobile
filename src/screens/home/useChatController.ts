import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { chatReducer, initialChatState, isSending } from './chatReducer';
import type { ApprovalDecision, ChatBackend, ChatModel } from './chatTypes';

let idSeq = 0;
const nextId = (p: string) => `${p}-${Date.now()}-${++idSeq}`;

export function useChatController(backend: ChatBackend) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const toast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      if (mounted.current) setToastMessage(null);
    }, 1800);
  }, []);

  useEffect(() => {
    mounted.current = true;
    backend
      .loadInitial()
      .then((snapshot) => mounted.current && dispatch({ type: 'loaded', snapshot }))
      .catch(() => mounted.current && toast('会話を読み込めませんでした'));
    return () => {
      mounted.current = false;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [backend, toast]);

  const send = useCallback(
    async (raw: string): Promise<boolean> => {
      const text = raw.trim();
      if (!text) return false;
      const agentId = nextId('agent');
      dispatch({ type: 'userSent', userId: nextId('user'), agentId, text });
      try {
        const reply = await backend.send(text, state.model);
        if (mounted.current) dispatch({ type: 'agentReplied', agentId, reply });
      } catch {
        if (mounted.current) {
          dispatch({ type: 'agentFailed', agentId, message: '送信に失敗しました。通信状況を確認してもう一度お試しください。' });
          toast('送信に失敗しました');
        }
      }
      return true;
    },
    [backend, state.model, toast],
  );

  const resolveApproval = useCallback(
    async (decision: ApprovalDecision) => {
      const approval = state.approval;
      if (!approval || state.resolvingApproval) return;
      dispatch({ type: 'approvalStarted' });
      try {
        await backend.resolveApproval(approval.id, decision);
        if (!mounted.current) return;
        dispatch({ type: 'approvalResolved', decision });
        toast(decision === 'approve' ? '許可しました。テストを実行します' : '拒否しました');
      } catch {
        if (!mounted.current) return;
        dispatch({ type: 'approvalFailed' });
        toast('承認の送信に失敗しました');
      }
    },
    [backend, state.approval, state.resolvingApproval, toast],
  );

  const changeModel = useCallback(
    async (model: ChatModel) => {
      const prev = state.model;
      dispatch({ type: 'modelChanged', model });
      try {
        if (backend.setModel) await backend.setModel(model);
        if (mounted.current) toast(`モデルを ${model} に変更しました`);
      } catch {
        if (mounted.current) {
          dispatch({ type: 'modelChanged', model: prev });
          toast('モデルを変更できませんでした');
        }
      }
    },
    [backend, state.model, toast],
  );

  return {
    state,
    sending: isSending(state),
    toastMessage,
    toast,
    send,
    approve: () => resolveApproval('approve'),
    deny: () => resolveApproval('deny'),
    changeModel,
  };
}
