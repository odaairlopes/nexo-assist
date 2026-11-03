import { Check, CircleAlert } from 'lucide-react';
import type { ChatMessage, DraftEdit, TicketSummary } from '@nexo/shared';
import { DecisionDetails } from '../../components/decision/DecisionDetails.tsx';
import { Spinner } from '../../components/ui.tsx';
import type { LiveTurn } from '../../hooks/useConversationState.ts';
import { DraftCard } from './cards/DraftCard.tsx';
import { QuickOptions, TicketCard, TicketSelector } from './cards/TicketCard.tsx';
import s from './ChatPage.module.css';

export interface ChatHandlers {
  send: (text: string) => void;
  confirmDraft: (draftId: string) => Promise<void>;
  cancelDraft: (draftId: string) => Promise<void>;
  editDraft: (draftId: string, edit: DraftEdit) => Promise<void>;
}

/** Rótulos das ações exibidos acima da resposta ("consultou seus chamados"). */
function actionLabels(message: ChatMessage): string[] {
  const labels = message.trace?.steps.flatMap((st) => st.label.split(' · ')) ?? [];
  return [...new Set(labels)];
}

function AgentMessage({
  message,
  interactive,
  latestDraftId,
  handlers,
}: {
  message: ChatMessage;
  interactive: boolean;
  latestDraftId: string | null;
  handlers: ChatHandlers;
}) {
  const ticketBlocks = message.ui.filter((b) => b.kind === 'ticket');
  const after = message.ui.filter((b) => b.kind === 'ticket_selector' || b.kind === 'draft');
  const options = message.ui.find((b) => b.kind === 'options');
  const labels = actionLabels(message);
  const failed = message.trace?.steps.filter((st) => !st.ok).map((st) => st.label) ?? [];

  return (
    <div className={s.agentMessage}>
      <div className={s.statusLine}>
        <strong>Nexo Assist</strong>
        {labels.map((l) => (
          <span key={l} className={s.action} data-failed={failed.includes(l)}>
            {failed.includes(l) ? <CircleAlert size={12} aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}
            {l}
          </span>
        ))}
      </div>

      {ticketBlocks.map((b) => b.kind === 'ticket' && <TicketCard key={b.ticket.id} ticket={b.ticket} />)}

      <div className={s.agentBubble}>
        <p>{message.content}</p>
        {options?.kind === 'options' && (
          <QuickOptions
            question={options.question}
            options={options.options}
            numbered={options.numbered}
            disabled={!interactive}
            onPick={handlers.send}
          />
        )}
      </div>

      {after.map((b) => {
        if (b.kind === 'ticket_selector') {
          return (
            <TicketSelector
              key="selector"
              tickets={b.tickets}
              disabled={!interactive}
              onSelect={(t: TicketSummary) => handlers.send(`${t.id} · ${t.title}`)}
            />
          );
        }
        if (b.kind === 'draft') {
          return (
            <DraftCard
              key={b.draft.id}
              draft={b.draft.status === 'pending' && b.draft.id !== latestDraftId ? { ...b.draft, status: 'cancelled' } : b.draft}
              // O rascunho mais recente continua acionável mesmo que a conversa tenha seguido.
              interactive={b.draft.id === latestDraftId && b.draft.status === 'pending'}
              onConfirm={() => handlers.confirmDraft(b.draft.id)}
              onCancel={() => handlers.cancelDraft(b.draft.id)}
              onEdit={(edit) => handlers.editDraft(b.draft.id, edit)}
            />
          );
        }
        return null;
      })}

      {message.trace && <DecisionDetails trace={message.trace} />}
    </div>
  );
}

function LiveAgent({ live }: { live: LiveTurn }) {
  return (
    <div className={s.agentMessage} aria-live="polite" aria-busy="true">
      <div className={s.statusLine}>
        <strong>Nexo Assist</strong>
        {live.actions.length === 0 && (
          <span className={s.action}>
            <Spinner size={10} /> pensando…
          </span>
        )}
        {live.actions.map((a) => (
          <span key={a.stepId} className={s.action} data-running={a.state === 'running'} data-failed={a.state === 'error'}>
            {a.state === 'running' ? <Spinner size={10} /> : a.state === 'error' ? <CircleAlert size={12} /> : <Check size={12} />}
            {a.label}
          </span>
        ))}
      </div>
      {live.text ? (
        <div className={s.agentBubble}>
          <p>
            {live.text}
            <span className={s.caret} aria-hidden="true" />
          </p>
        </div>
      ) : (
        <div className={s.typing} aria-label="Nexo Assist está escrevendo">
          <span />
          <span />
          <span />
        </div>
      )}
    </div>
  );
}

export function ChatMessages({
  messages,
  live,
  handlers,
}: {
  messages: ChatMessage[];
  live: LiveTurn | null;
  handlers: ChatHandlers;
}) {
  // Só a última mensagem do agent (sem outra fala depois) aceita cliques nas opções/cards.
  const lastAgentIndex = messages.reduce((acc, m, i) => (m.role === 'agent' ? i : acc), -1);
  const interactiveIndex = lastAgentIndex === messages.length - 1 && !live ? lastAgentIndex : -1;
  // Só existe um rascunho pendente por vez: o mais recente exibido.
  let latestDraftId: string | null = null;
  for (const m of messages) for (const b of m.ui) if (b.kind === 'draft') latestDraftId = b.draft.id;

  return (
    <>
      {messages.map((m, i) => {
        if (m.role === 'user') {
          return (
            <div key={m.id} className={s.userRow}>
              <p className={s.userBubble}>{m.content}</p>
            </div>
          );
        }
        if (m.role === 'system') {
          return (
            <div key={m.id} className={s.systemLine} role="status">
              <span>{m.content}</span>
            </div>
          );
        }
        if (m.role === 'analyst') {
          return (
            <div key={m.id} className={s.agentMessage}>
              <div className={s.statusLine}>
                <strong>{m.author?.name}</strong>
                <span className={s.humanTag}>Analista</span>
              </div>
              <div className={`${s.agentBubble} ${s.humanBubble}`}>
                <p>{m.content}</p>
              </div>
            </div>
          );
        }
        return (
          <AgentMessage key={m.id} message={m} interactive={i === interactiveIndex} latestDraftId={latestDraftId} handlers={handlers} />
        );
      })}
      {live && <LiveAgent live={live} />}
    </>
  );
}
