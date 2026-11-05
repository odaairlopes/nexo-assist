import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, ArrowUpRight, ChevronRight, History, UserCheck, X } from 'lucide-react';
import {
  ACTIVE_STATUSES,
  formatLocalDay,
  formatLocalTime,
  PRIORITY_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  type ConversationView,
  type TicketView,
} from '@nexo/shared';
import { ApiError } from '../../api/client.ts';
import { consoleApi } from '../../api/endpoints.ts';
import { Dot, ErrorBanner, Spinner } from '../../components/ui.tsx';
import { TicketsDialog } from './TicketsDialog.tsx';
import s from './Console.module.css';

/** Última movimentação do chamado, em uma linha (o texto completo fica no histórico do legado). */
function EventLine({ event }: { event: NonNullable<TicketView['lastEvent']> }) {
  if (event.kind === 'transfer') {
    return (
      <>
        <ArrowLeftRight size={15} aria-hidden="true" />
        <span>Transferido para um analista</span>
      </>
    );
  }
  if (event.kind === 'assign') {
    return (
      <>
        <UserCheck size={15} aria-hidden="true" />
        <span>{event.text}</span>
      </>
    );
  }
  return (
    <>
      <History size={15} aria-hidden="true" />
      <span title={event.text}>{event.text}</span>
    </>
  );
}

/** Painel "Chamados da Ana": o chamado da conversa em destaque + os demais. */
export function TicketHistory({
  conversation,
  onClose,
  drawer = false,
}: {
  conversation: ConversationView;
  onClose: () => void;
  /** Em telas menores o painel abre por cima da conversa (gaveta lateral ou folha inferior). */
  drawer?: boolean;
}) {
  const [tickets, setTickets] = useState<TicketView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const first = conversation.employee.name.split(' ')[0];

  const load = useCallback(async () => {
    setError(null);
    try {
      setTickets((await consoleApi.tickets(conversation.id)).tickets);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar os chamados.');
    }
  }, [conversation.id]);

  // Recarrega quando muda a conversa, o chamado vinculado ou o status (ex.: assumiu → "Em andamento").
  useEffect(() => {
    void load();
  }, [load, conversation.ticketRef, conversation.status]);

  const current = tickets?.find((t) => t.id === conversation.ticketRef) ?? null;
  const others = tickets?.filter((t) => t.id !== current?.id) ?? [];
  const open = tickets?.filter((t) => ACTIVE_STATUSES.includes(t.status)).length ?? 0;

  return (
    <>
      {drawer && <div className={s.historyBackdrop} onClick={onClose} aria-hidden="true" />}
      <aside
        className={s.history}
        data-drawer={drawer}
        aria-label={`Chamados de ${conversation.employee.name}`}
        {...(drawer ? { role: 'dialog', 'aria-modal': true } : {})}
      >
      {drawer && <span className={s.grabber} aria-hidden="true" />}
      <header className={s.historyHeader}>
        <div>
          <strong>Chamados {first ? `de ${first}` : ''}</strong>
          <span>{tickets ? `${open} abertos · ${tickets.length - open} encerrados` : 'Carregando…'}</span>
        </div>
        <button type="button" className={s.iconButton} onClick={onClose} aria-label="Fechar painel de chamados">
          <X size={18} />
        </button>
      </header>

      <div className={s.historyBody}>
        {error && <ErrorBanner message={error} onRetry={() => void load()} />}
        {!tickets && !error && (
          <div className={s.centerBox}>
            <Spinner size={16} />
          </div>
        )}

        {current && (
          <section>
            <h3 className={s.sectionLabel}>Desta conversa</h3>
            <div className={s.currentTicket}>
              <div className={s.currentRow}>
                <span>{current.id}</span>
                <span className={s.currentStatus} data-tone={current.sla.overdue ? 'warning' : STATUS_TONE[current.status]}>
                  <Dot tone={current.sla.overdue ? 'warning' : STATUS_TONE[current.status]} size={7} />
                  {conversation.status === 'human' ? 'Em atendimento' : STATUS_LABEL[current.status]}
                </span>
              </div>
              <strong>{current.title}</strong>
              <span className={s.muted}>
                {current.category} · prioridade {PRIORITY_LABEL[current.priority].toLowerCase()}
                {current.sla.overdue && ' · prazo vencido'}
              </span>
              <p className={s.currentDesc}>{current.description}</p>
              {current.lastEvent && (
                <div className={s.lastEvent}>
                  <EventLine event={current.lastEvent} />
                  <time>{formatLocalTime(new Date(current.lastEvent.at))}</time>
                </div>
              )}
            </div>
          </section>
        )}

        {tickets && (
          <section>
            <h3 className={s.sectionLabel}>{current ? 'Outros chamados' : 'Chamados'}</h3>
            {others.length === 0 && <p className={s.muted}>Nenhum outro chamado.</p>}
            <ul className={s.ticketList}>
              {others.map((t) => (
                <li key={t.id}>
                  <button type="button" className={s.ticketRow} aria-expanded={expanded === t.id} onClick={() => setExpanded(expanded === t.id ? null : t.id)}>
                    <Dot tone={t.status === 'resolved' || t.status === 'closed' ? 'neutral' : t.sla.overdue ? 'warning' : STATUS_TONE[t.status]} size={7} />
                    <span className={s.ticketText}>
                      <strong>{t.title}</strong>
                      <span>
                        {t.id} ·{' '}
                        {t.status === 'resolved' && t.resolvedAt
                          ? `Resolvido em ${formatLocalDay(new Date(t.resolvedAt))}`
                          : STATUS_LABEL[t.status]}
                        {t.sla.overdue && ' · vencido'}
                      </span>
                    </span>
                    <ChevronRight size={16} className={s.chevron} data-open={expanded === t.id} aria-hidden="true" />
                  </button>
                  {expanded === t.id && <p className={s.ticketDesc}>{t.description}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {tickets && tickets.length > 0 && (
        <footer className={s.historyFooter}>
          <button type="button" className={s.seeAll} onClick={() => setShowAll(true)} aria-haspopup="dialog">
            Ver todos os chamados de {first}
            <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        </footer>
      )}
      </aside>
      {tickets && (
        <TicketsDialog conversation={conversation} tickets={tickets} open={showAll} onClose={() => setShowAll(false)} />
      )}
    </>
  );
}
