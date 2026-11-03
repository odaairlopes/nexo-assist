import { useCallback, useEffect, useState } from 'react';
import { LogOut, MessagesSquare, PanelRightOpen } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ConversationView, ServerEvent } from '@nexo/shared';
import { ApiError } from '../../api/client.ts';
import { consoleApi } from '../../api/endpoints.ts';
import { Avatar, ErrorBanner, NexoMark, Spinner } from '../../components/ui.tsx';
import { useConversationState } from '../../hooks/useConversationState.ts';
import { useEventStream } from '../../hooks/useEventStream.ts';
import { useSession } from '../../session/SessionProvider.tsx';
import { ConversationList } from './ConversationList.tsx';
import { ConversationPane } from './ConversationPane.tsx';
import { TicketHistory } from './TicketHistory.tsx';
import s from './Console.module.css';

function upsertConversation(list: ConversationView[], c: ConversationView): ConversationView[] {
  const i = list.findIndex((x) => x.id === c.id);
  if (i === -1) return [c, ...list];
  const next = list.slice();
  next[i] = c;
  return next;
}

export function ConsolePage() {
  const { user, logout } = useSession();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<ConversationView[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(true);
  const { state, load, apply } = useConversationState();

  const loadList = useCallback(async () => {
    try {
      const { conversations: list } = await consoleApi.list();
      setConversations(list);
      setListError(null);
      // Abre a primeira que precisa de atendimento.
      setSelectedId((cur) => cur ?? list.find((c) => c.status === 'waiting_human')?.id ?? list[0]?.id ?? null);
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Não foi possível carregar as conversas.');
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Canal global: mudanças de estado e mensagens novas de qualquer conversa.
  const onConsoleEvent = useCallback((e: ServerEvent) => {
    if (e.type === 'conversation') setConversations((l) => (l ? upsertConversation(l, e.conversation) : l));
    if (e.type === 'message' && e.message.role !== 'system') {
      setConversations((l) =>
        l?.map((c) =>
          c.id === e.message.conversationId
            ? { ...c, updatedAt: e.message.createdAt, lastMessage: { role: e.message.role, content: e.message.content, at: e.message.createdAt } }
            : c,
        ) ?? l,
      );
    }
  }, []);
  useEventStream('/api/console/events', onConsoleEvent, loadList);

  const loadSelected = useCallback(async () => {
    if (!selectedId) return;
    try {
      const r = await consoleApi.get(selectedId);
      load(r.conversation, r.messages);
    } catch {
      /* erro já visível na lista */
    }
  }, [selectedId, load]);

  useEffect(() => {
    void loadSelected();
  }, [loadSelected]);

  useEventStream(selectedId ? `/api/conversations/${selectedId}/events` : null, apply, loadSelected);

  const waiting = conversations?.filter((c) => c.status === 'waiting_human').length ?? 0;
  const selected = state.conversation && state.conversation.id === selectedId ? state.conversation : null;

  if (!user) return null;

  return (
    <div className={s.console}>
      <nav className={s.rail} aria-label="Console">
        <div className={s.railLogo}>
          <NexoMark size={22} />
        </div>
        <button type="button" className={s.railItem} aria-current="page" aria-label={`Conversas, ${waiting} aguardando`}>
          <MessagesSquare size={19} />
          {waiting > 0 && <span className={s.badge}>{waiting}</span>}
        </button>
        <span className={s.railSpacer} />
        <button
          type="button"
          className={s.railItem}
          aria-label="Sair"
          title="Sair"
          onClick={async () => {
            await logout();
            navigate('/login', { replace: true });
          }}
        >
          <LogOut size={17} />
        </button>
        <span title={`${user.name} · Suporte ${user.supportLevel ?? ''}`}>
          <Avatar name={user.name} size={36} online ringColor="var(--desk)" />
        </span>
      </nav>

      {listError && !conversations && (
        <div className={s.centerBox}>
          <ErrorBanner message={listError} onRetry={() => void loadList()} />
        </div>
      )}
      {!conversations && !listError && (
        <div className={s.centerBox}>
          <Spinner size={18} />
        </div>
      )}

      {conversations && (
        <>
          <ConversationList conversations={conversations} selectedId={selectedId} me={user} onSelect={setSelectedId} />
          {selected ? (
            <ConversationPane
              conversation={selected}
              messages={state.messages}
              live={state.live}
              me={user}
              onChanged={(c) => apply({ type: 'conversation', conversation: c })}
            />
          ) : (
            <div className={s.emptyPane}>{selectedId ? <Spinner size={18} /> : 'Selecione uma conversa'}</div>
          )}
          {selected && showHistory && <TicketHistory conversation={selected} onClose={() => setShowHistory(false)} />}
          {selected && !showHistory && (
            <button type="button" className={s.reopenHistory} onClick={() => setShowHistory(true)} aria-label="Mostrar chamados do funcionário">
              <PanelRightOpen size={18} />
            </button>
          )}
        </>
      )}
    </div>
  );
}
