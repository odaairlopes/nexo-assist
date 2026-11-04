import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCheck, CircleStop, Hand, Info, PauseCircle, SendHorizontal, Undo2 } from 'lucide-react';
import { formatLocalTime, isSameLocalDay, type ChatMessage, type ConversationView, type SessionUser, type TransferKind } from '@nexo/shared';
import { ApiError } from '../../api/client.ts';
import { consoleApi } from '../../api/endpoints.ts';
import { DecisionDetails } from '../../components/decision/DecisionDetails.tsx';
import { Avatar, Button, ErrorBanner, Pill, Spinner } from '../../components/ui.tsx';
import type { LiveTurn } from '../../hooks/useConversationState.ts';
import { useStickToBottom } from '../../hooks/useStickToBottom.ts';
import { useTypingNotifier } from '../../hooks/useTyping.ts';
import s from './Console.module.css';

const TRANSFER_REASON: Record<TransferKind, string> = {
  requested: 'Funcionário pediu um analista',
  critical: 'Caso crítico',
  overdue: 'Chamado com prazo vencido',
  low_confidence: 'Agent sem segurança para decidir',
  agent_error: 'Falha do agent',
};

function Message({ m }: { m: ChatMessage }) {
  const time = formatLocalTime(new Date(m.createdAt));
  if (m.role === 'system') {
    return (
      <div className={s.system} role="status">
        <span>
          <Info size={13} aria-hidden="true" /> {m.content}
        </span>
      </div>
    );
  }
  if (m.role === 'user') {
    return (
      <div className={s.clientMsg}>
        <div className={s.bubble} data-kind="client">
          <span>{m.content}</span>
          <span className={s.time}>{time}</span>
        </div>
      </div>
    );
  }
  const isAgent = m.role === 'agent';
  return (
    <div className={s.outMsg}>
      <div className={s.sender}>
        <strong>{isAgent ? 'Nexo Assist' : m.author?.name}</strong>
        <span className={s.senderTag} data-kind={isAgent ? 'ai' : 'human'}>
          {isAgent ? 'IA' : 'Analista'}
        </span>
      </div>
      <div className={s.bubble} data-kind={isAgent ? 'agent' : 'human'}>
        <span>{m.content}</span>
        {m.ui.length > 0 && (
          <span className={s.uiNote}>
            {m.ui
              .map((b) =>
                b.kind === 'ticket'
                  ? `card ${b.ticket.id}`
                  : b.kind === 'draft'
                    ? `rascunho ${b.draft.code} (${b.draft.status === 'confirmed' ? `confirmado → ${b.draft.ticketId}` : b.draft.status})`
                    : b.kind === 'ticket_selector'
                      ? `seletor: ${b.tickets.map((t) => t.id).join(', ')}`
                      : b.options.length > 0
                        ? `opções: ${b.options.map((o) => o.label).join(' | ')}`
                        : b.question
                          ? `perguntou: ${b.question}`
                          : '',
              )
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
        <span className={s.time}>
          {time} <CheckCheck size={14} aria-hidden="true" />
        </span>
      </div>
      {m.trace && <DecisionDetails trace={m.trace} compact />}
    </div>
  );
}

export function ConversationPane({
  conversation,
  messages,
  live,
  me,
  onChanged,
  typingName = null,
}: {
  conversation: ConversationView;
  messages: ChatMessage[];
  live: LiveTurn | null;
  /** Funcionário digitando agora (nome), se houver. */
  typingName?: string | null;
  me: SessionUser;
  onChanged: (c: ConversationView) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const { scrollToBottom, follow } = useStickToBottom(scrollRef, contentRef);
  useLayoutEffect(follow, [follow, messages, live, typingName]);
  const mine = conversation.status === 'human' && conversation.assignedAnalyst?.email === me.email;
  const notifyTyping = useTypingNotifier(conversation.id, mine);
  const first = conversation.employee.name.split(' ')[0];

  // Trocou de conversa: começa no fim. O resto (mensagens, digitando…) o hook acompanha.
  useEffect(() => {
    scrollToBottom();
  }, [conversation.id, scrollToBottom]);

  async function act(name: string, fn: () => Promise<{ conversation: ConversationView }>) {
    setBusy(name);
    setError(null);
    try {
      onChanged((await fn()).conversation);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível concluir a ação.');
    } finally {
      setBusy(null);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    setBusy('send');
    setError(null);
    try {
      await consoleApi.send(conversation.id, content);
      scrollToBottom();
      setText('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível enviar.');
    } finally {
      setBusy(null);
    }
  }

  const transfer = conversation.transfer;
  const firstDay = messages[0] ? new Date(messages[0].createdAt) : null;

  return (
    <section className={s.pane} aria-label={`Conversa com ${conversation.employee.name}`}>
      <header className={s.paneHeader}>
        <Avatar name={conversation.employee.name} size={40} />
        <div className={s.who}>
          <strong>{conversation.employee.name}</strong>
          <span>
            {conversation.employeeOnline && <span className={s.onlineText}>online · </span>}
            {conversation.employee.department}
            {conversation.ticketRef ? ` · ${conversation.ticketRef}` : ''}
          </span>
        </div>
        {conversation.status === 'waiting_human' && (
          <Pill tone="warning" icon={<PauseCircle size={14} />}>
            Aguardando atendente
          </Pill>
        )}
        {conversation.status === 'agent' && <Pill tone="success">Agent atendendo</Pill>}
        {conversation.status === 'closed' && <Pill tone="primary">Encerrada</Pill>}
        {conversation.status === 'human' && !mine && <Pill tone="primary">Com {conversation.assignedAnalyst?.name}</Pill>}
        {mine && (
          <>
            <Button icon={<Undo2 size={14} />} loading={busy === 'return'} onClick={() => act('return', () => consoleApi.giveBack(conversation.id))}>
              Devolver ao agent
            </Button>
            <Button
              variant="danger"
              icon={<CircleStop size={14} />}
              loading={busy === 'close'}
              onClick={() => act('close', () => consoleApi.close(conversation.id))}
            >
              Encerrar atendimento
            </Button>
          </>
        )}
      </header>

      <div className={s.paneMessages} ref={scrollRef}>
        <div className={s.paneInner} ref={contentRef}>
        {firstDay && (
          <div className={s.day}>
            <span>{isSameLocalDay(firstDay, new Date()) ? 'Hoje' : firstDay.toLocaleDateString('pt-BR')}</span>
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} m={m} />
        ))}
        {typingName && !live && (
          <div className={s.clientMsg} aria-live="polite">
            <div className={s.bubble} data-kind="client">
              <span className={s.typingBubble} aria-label={`${typingName} está digitando`}>
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        )}
        {live && (
          <div className={s.outMsg}>
            <div className={s.sender}>
              <strong>Nexo Assist</strong>
              <span className={s.senderTag} data-kind="ai">
                IA
              </span>
            </div>
            <div className={s.bubble} data-kind="agent">
              <span className={s.liveLine}>
                <Spinner size={10} /> {live.actions.at(-1)?.label ?? 'pensando'}…
              </span>
            </div>
          </div>
        )}
        </div>
      </div>

      <footer className={s.takeover}>
        {error && <ErrorBanner message={error} />}

        {conversation.status === 'waiting_human' && transfer && (
          <div className={s.summary}>
            <strong>Resumo do agent · {TRANSFER_REASON[transfer.kind]}</strong>
            <p>{transfer.summary}</p>
            <span>
              {transfer.reason}
              {transfer.confidence !== null && ` · confiança ${Math.round(transfer.confidence * 100)}%`} · fila Suporte {transfer.queue}
            </span>
          </div>
        )}

        {(conversation.status === 'waiting_human' || conversation.status === 'agent') && (
          <>
            <div className={s.takeoverRow}>
              <span className={s.iconWrap} data-tone={conversation.status === 'agent' ? 'success' : 'warning'}>
                <Hand size={17} aria-hidden="true" />
              </span>
              <div className={s.takeoverText}>
                <strong>{conversation.status === 'waiting_human' ? `${first} espera um atendente` : `O agent está atendendo ${first}`}</strong>
                <span>
                  {conversation.status === 'waiting_human'
                    ? `Agent pausado · desde ${transfer ? formatLocalTime(new Date(transfer.at)) : '—'}`
                    : 'Você pode assumir a qualquer momento; o agent pausa na hora.'}
                </span>
              </div>
              {conversation.status === 'waiting_human' && (
                <Button icon={<Undo2 size={15} />} loading={busy === 'return'} onClick={() => act('return', () => consoleApi.giveBack(conversation.id))}>
                  Devolver ao agent
                </Button>
              )}
              <Button variant="primary" icon={<Hand size={16} />} loading={busy === 'take'} onClick={() => act('take', () => consoleApi.take(conversation.id))}>
                Assumir atendimento
              </Button>
            </div>
            <div className={s.lockedInput}>Assuma o atendimento para responder</div>
          </>
        )}

        {conversation.status === 'human' && mine && (
          <form className={s.analystComposer} onSubmit={send}>
            <label htmlFor="analyst-input" className="sr-only">
              Mensagem para {conversation.employee.name}
            </label>
            <input
              id="analyst-input"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (e.target.value) notifyTyping();
              }}
              placeholder={`Responder ${first}…`}
              maxLength={2000}
              autoFocus
            />
            <button type="submit" className={s.sendRound} disabled={!text.trim() || busy === 'send'} aria-label="Enviar">
              {busy === 'send' ? <Spinner size={14} /> : <SendHorizontal size={18} />}
            </button>
          </form>
        )}

        {conversation.status === 'human' && !mine && (
          <div className={s.lockedInput}>{conversation.assignedAnalyst?.name} está atendendo esta conversa.</div>
        )}
        {conversation.status === 'closed' && <div className={s.lockedInput}>Atendimento encerrado.</div>}
      </footer>
    </section>
  );
}
