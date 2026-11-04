import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Headset, RotateCcw, SendHorizontal } from 'lucide-react';
import type { ConversationView, DraftEdit, ServerEvent } from '@nexo/shared';
import { ApiError } from '../../api/client.ts';
import { chatApi } from '../../api/endpoints.ts';
import { Button, ErrorBanner, Pill, Spinner } from '../../components/ui.tsx';
import { useConversationState } from '../../hooks/useConversationState.ts';
import { useStickToBottom } from '../../hooks/useStickToBottom.ts';
import { useTypingNotifier, useTypingState } from '../../hooks/useTyping.ts';
import { useEventStream } from '../../hooks/useEventStream.ts';
import { useSession } from '../../session/SessionProvider.tsx';
import { EmployeeShell } from '../shell/EmployeeShell.tsx';
import { ChatMessages, type ChatHandlers } from './ChatMessages.tsx';
import s from './ChatPage.module.css';

function StatusPill({ conversation, stream }: { conversation: ConversationView | null; stream: string }) {
  if (!conversation) return null;
  if (stream === 'reconnecting') return <Pill tone="warning">Reconectando…</Pill>;
  switch (conversation.status) {
    case 'agent':
      return <Pill tone="success">Assistente online</Pill>;
    case 'waiting_human':
      return <Pill tone="warning">Aguardando analista</Pill>;
    case 'human':
      return <Pill tone="primary">{conversation.assignedAnalyst?.name ?? 'Analista'} atendendo</Pill>;
    case 'closed':
      return <Pill tone="primary">Atendimento encerrado</Pill>;
  }
}

export function ChatPage() {
  const { state, load, apply, addLocal } = useConversationState();
  const { conversation, messages, live } = state;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const { scrollToBottom, follow } = useStickToBottom(scrollRef, contentRef);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await chatApi.current();
      load(r.conversation, r.messages);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Não foi possível carregar a conversa.');
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Analista digitando aparece para o funcionário; a mensagem dele apaga o aviso.
  const { typing, onTyping, clear } = useTypingState();
  const onEvent = useCallback(
    (e: ServerEvent) => {
      if (e.type === 'typing' && e.role === 'analyst') onTyping(e);
      if (e.type === 'message' && e.message.role === 'analyst') clear(e.message.conversationId);
      apply(e);
    },
    [apply, onTyping, clear],
  );
  const { revalidate } = useSession();
  const stream = useEventStream(conversation ? `/api/conversations/${conversation.id}/events` : null, onEvent, refresh, revalidate);
  const notifyTyping = useTypingNotifier(conversation?.id ?? null);
  const analystTyping = conversation ? typing[conversation.id] : undefined;

  // Conteúdo novo (mensagem, ação do agent, "digitando…", aviso): acompanha o fim.
  useLayoutEffect(follow, [follow, messages, live, analystTyping, conversation?.status]);


  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || !conversation || sending) return;
      setSending(true);
      setActionError(null);
      try {
        const { message } = await chatApi.send(conversation.id, content);
        addLocal(message);
        scrollToBottom();
        setDraft('');
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : 'Não foi possível enviar.');
      } finally {
        setSending(false);
        inputRef.current?.focus();
      }
    },
    [conversation, sending, addLocal, scrollToBottom],
  );

  const handlers: ChatHandlers = useMemo(
    () => ({
      send: (t) => void send(t),
      confirmDraft: async (draftId) => {
        if (conversation) await chatApi.confirmDraft(conversation.id, draftId);
      },
      cancelDraft: async (draftId) => {
        if (conversation) await chatApi.cancelDraft(conversation.id, draftId);
      },
      editDraft: async (draftId: string, edit: DraftEdit) => {
        if (conversation) await chatApi.editDraft(conversation.id, draftId, edit);
      },
    }),
    [conversation, send],
  );

  async function startNew() {
    setActionError(null);
    try {
      const r = await chatApi.startNew();
      load(r.conversation, r.messages);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível iniciar uma nova conversa.');
    }
  }

  // Atalho: teclas 1–4 escolhem a opção numerada quando o campo está vazio.
  const lastOptions = useMemo(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'agent' || live) return null;
    const block = last.ui.find((b) => b.kind === 'options');
    return block?.kind === 'options' && block.numbered ? block.options : null;
  }, [messages, live]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      void send(draft);
      return;
    }
    if (!draft && lastOptions && /^[1-4]$/.test(e.key)) {
      const option = lastOptions[Number(e.key) - 1];
      if (option) {
        e.preventDefault();
        void send(option.value);
      }
    }
  }

  const limitReached = conversation ? conversation.userMessageCount >= conversation.messageLimit : false;
  const closed = conversation?.status === 'closed';
  const composerDisabled = !conversation || closed || limitReached;

  return (
    <EmployeeShell
      title="Atendimento"
      status={
        <>
          <StatusPill conversation={conversation} stream={stream} />
          {/* Recomeçar a qualquer momento, exceto com um analista atendendo. */}
          {conversation?.status === 'agent' && messages.length > 0 && (
            <Button variant="ghost" icon={<RotateCcw size={14} />} onClick={() => void startNew()} aria-label="Nova conversa" className={s.newChat}>
              <span className="hide-sm">Nova conversa</span>
            </Button>
          )}
        </>
      }
    >
      <div className={s.chat}>
        <div className={s.messages} ref={scrollRef} aria-live="polite">
          <div className={s.messagesInner} ref={contentRef}>
            {!conversation && !loadError && (
              <div className={s.center}>
                <Spinner size={18} />
              </div>
            )}
            {loadError && <ErrorBanner message={loadError} onRetry={() => void refresh()} />}
            {conversation && messages.length === 0 && (
              <div className={s.empty}>
                <h2>Olá! Como posso ajudar?</h2>
                <p>Descreva o problema com suas palavras. Eu consulto seus chamados, busco na central de ajuda e chamo um analista se precisar.</p>
                <div className={s.suggestions}>
                  {['Qual o status do meu chamado?', 'Meu notebook não conecta na VPN', 'Preciso de acesso a um sistema', 'Quero falar com um analista'].map(
                    (t) => (
                      <button key={t} type="button" onClick={() => void send(t)}>
                        {t}
                      </button>
                    ),
                  )}
                </div>
              </div>
            )}
            <ChatMessages messages={messages} live={live} handlers={handlers} typingName={analystTyping?.name ?? null} />
          </div>
        </div>

        <div className={s.composerArea}>
          {conversation?.status === 'waiting_human' && (
            <div className={s.notice} data-tone="warning">
              <Headset size={16} aria-hidden="true" />
              <span>
                Um analista do <strong>Suporte {conversation.transfer?.queue ?? 'N1'}</strong> vai continuar com você aqui. Enquanto isso, o
                assistente fica pausado — pode escrever que ele vê o histórico.
              </span>
            </div>
          )}
          {conversation?.status === 'human' && (
            <div className={s.notice} data-tone="primary">
              <Headset size={16} aria-hidden="true" />
              <span>
                <strong>{conversation.assignedAnalyst?.name}</strong> está te atendendo.
              </span>
            </div>
          )}
          {(closed || limitReached) && (
            <div className={s.notice} data-tone="neutral">
              <span>
                {closed
                  ? 'Este atendimento foi encerrado.'
                  : `Você chegou ao limite de ${conversation?.messageLimit} mensagens nesta sessão.`}
              </span>
              <Button variant="primary" icon={<RotateCcw size={14} />} onClick={() => void startNew()}>
                Nova conversa
              </Button>
            </div>
          )}
          {actionError && <ErrorBanner message={actionError} />}

          <form
            className={s.composer}
            data-disabled={composerDisabled}
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <label htmlFor="composer" className="sr-only">
              Mensagem para o Nexo Assist
            </label>
            <textarea
              id="composer"
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (e.target.value) notifyTyping();
              }}
              onKeyDown={onKeyDown}
              placeholder={!conversation ? 'Carregando…' : composerDisabled ? 'Inicie uma nova conversa para continuar' : 'Escreva para o Nexo…'}
              disabled={composerDisabled}
              maxLength={2000}
              // No celular, focar sozinho abriria o teclado e cobriria a conversa.
              autoFocus={window.matchMedia('(pointer: fine)').matches}
            />
            <button type="submit" className={s.send} disabled={composerDisabled || sending || !draft.trim()} aria-label="Enviar">
              {sending ? <Spinner size={14} /> : <SendHorizontal size={14} aria-hidden="true" />}
              <span className="hide-sm">Enviar</span>
            </button>
          </form>
          <div className={s.meta}>
            {conversation && (
              <span>
                {conversation.userMessageCount}/{conversation.messageLimit} mensagens nesta sessão
              </span>
            )}
          </div>
        </div>
      </div>
    </EmployeeShell>
  );
}
