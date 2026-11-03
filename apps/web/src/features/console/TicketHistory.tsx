import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, History, X } from 'lucide-react';
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
import s from './Console.module.css';

/** Painel "Chamados da Ana": o chamado da conversa em destaque + os demais. */
export function TicketHistory({ conversation, onClose }: { conversation: ConversationView; onClose: () => void }) {
  const [tickets, setTickets] = useState<TicketView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
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
    <aside className={s.history} aria-label={`Chamados de ${conversation.employee.name}`}>
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
                  <History size={15} aria-hidden="true" />
                  <span>{current.lastEvent.text}</span>
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
    </aside>
  );
}
