import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import {
  ACTIVE_STATUSES,
  formatLocalDay,
  formatLocalTime,
  formatRelative,
  IMPACT_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  TYPE_LABEL,
  type ConversationView,
  type TicketView,
} from '@nexo/shared';
import { Avatar, Dot } from '../../components/ui.tsx';
import { normalize } from './filters.ts';
import s from './TicketsDialog.module.css';

type Scope = 'all' | 'open' | 'closed';

const isOpen = (t: TicketView) => ACTIVE_STATUSES.includes(t.status);

function when(iso: string): string {
  const d = new Date(iso);
  return `${formatLocalDay(d)} · ${formatLocalTime(d)}`;
}

/**
 * "Ver todos os chamados da Ana": o histórico completo do funcionário numa
 * janela maior que o painel lateral — com abas abertos/encerrados, busca e os
 * detalhes de cada chamado (prazo, impacto, datas e última movimentação).
 * Usa o <dialog> nativo: foco preso dentro, Esc fecha e o fundo fica inerte.
 */
export function TicketsDialog({
  conversation,
  tickets,
  open,
  onClose,
}: {
  conversation: ConversationView;
  tickets: TicketView[];
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [scope, setScope] = useState<Scope>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(conversation.ticketRef);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const counts = useMemo(() => {
    const opened = tickets.filter(isOpen).length;
    return { all: tickets.length, open: opened, closed: tickets.length - opened };
  }, [tickets]);

  const visible = useMemo(() => {
    const q = normalize(query.trim());
    return tickets
      .filter((t) => (scope === 'all' ? true : scope === 'open' ? isOpen(t) : !isOpen(t)))
      .filter((t) => !q || [t.id, t.title, t.category, t.description].some((f) => normalize(f).includes(q)))
      // Abertos primeiro; dentro de cada grupo, o mais recente em cima.
      .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || b.updatedAt.localeCompare(a.updatedAt));
  }, [tickets, scope, query]);

  const scopes: { id: Scope; label: string }[] = [
    { id: 'all', label: 'Todos' },
    { id: 'open', label: 'Abertos' },
    { id: 'closed', label: 'Encerrados' },
  ];

  return (
    <dialog
      ref={ref}
      className={s.dialog}
      aria-labelledby="tickets-dialog-title"
      onClose={onClose}
      // Esc fecha só a janela, não o painel de chamados que está atrás.
      onKeyDown={(e) => e.key === 'Escape' && e.stopPropagation()}
      // Clique no fundo escuro (fora da caixa) fecha.
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={s.box}>
        <header className={s.header}>
          <Avatar name={conversation.employee.name} size={40} />
          <div className={s.title}>
            <h2 id="tickets-dialog-title">Chamados de {conversation.employee.name}</h2>
            <span>
              {conversation.employee.department} · {counts.open} abertos · {counts.closed} encerrados
            </span>
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>

        <div className={s.toolbar}>
          <div className={s.scopes} role="tablist" aria-label="Situação">
            {scopes.map((sc) => (
              <button
                key={sc.id}
                type="button"
                role="tab"
                aria-selected={scope === sc.id}
                className={s.scope}
                onClick={() => setScope(sc.id)}
              >
                {sc.label}
                <strong>{counts[sc.id]}</strong>
              </button>
            ))}
          </div>
          <label className={s.search}>
            <Search size={15} aria-hidden="true" />
            <span className="sr-only">Buscar chamado</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Número, título ou categoria" type="search" />
          </label>
        </div>

        <ul className={s.list}>
          {visible.length === 0 && <li className={s.empty}>Nenhum chamado encontrado.</li>}
          {visible.map((t) => {
            const isExpanded = expanded === t.id;
            const tone = t.sla.overdue ? 'warning' : t.status === 'resolved' || t.status === 'closed' ? 'neutral' : STATUS_TONE[t.status];
            return (
              <li key={t.id} className={s.item} data-expanded={isExpanded}>
                <button
                  type="button"
                  className={s.row}
                  aria-expanded={isExpanded}
                  aria-controls={`ticket-${t.id}`}
                  onClick={() => setExpanded(isExpanded ? null : t.id)}
                >
                  <Dot tone={tone} size={8} />
                  <span className={s.main}>
                    <span className={s.top}>
                      <span className={s.id}>{t.id}</span>
                      {t.id === conversation.ticketRef && <span className={s.thisTag}>desta conversa</span>}
                      {t.sla.overdue && <span className={s.overdueTag}>vencido</span>}
                    </span>
                    <strong>{t.title}</strong>
                  </span>
                  <span className={s.meta}>
                    <span className={s.status} data-tone={tone}>
                      {STATUS_LABEL[t.status]}
                    </span>
                    <span className={s.updated}>{formatRelative(t.updatedAt)}</span>
                  </span>
                  <ChevronDown size={17} className={s.chevron} aria-hidden="true" />
                </button>

                {isExpanded && (
                  <div id={`ticket-${t.id}`} className={s.details}>
                    <p className={s.description}>{t.description}</p>
                    <dl className={s.facts}>
                      <div>
                        <dt>Tipo</dt>
                        <dd>{TYPE_LABEL[t.type]}</dd>
                      </div>
                      <div>
                        <dt>Categoria</dt>
                        <dd>
                          {t.category}
                          {t.subcategory ? ` · ${t.subcategory}` : ''}
                        </dd>
                      </div>
                      <div>
                        <dt>Prioridade</dt>
                        <dd>
                          <Dot tone={PRIORITY_TONE[t.priority]} /> {PRIORITY_LABEL[t.priority]}
                        </dd>
                      </div>
                      <div>
                        <dt>Afetados</dt>
                        <dd>{IMPACT_LABEL[t.affected]}</dd>
                      </div>
                      <div>
                        <dt>Aberto em</dt>
                        <dd>{when(t.createdAt)}</dd>
                      </div>
                      <div>
                        <dt>{t.resolvedAt ? 'Resolvido em' : 'Prazo'}</dt>
                        <dd className={t.sla.overdue ? s.overdueText : undefined}>
                          {t.resolvedAt
                            ? when(t.resolvedAt)
                            : t.sla.running && t.sla.dueAt
                              ? `${t.sla.overdue ? 'venceu' : 'vence'} ${when(t.sla.dueAt)}`
                              : 'Sem prazo correndo'}
                        </dd>
                      </div>
                    </dl>
                    {t.lastEvent && (
                      <p className={s.event}>
                        <span>Última movimentação · {when(t.lastEvent.at)}</span>
                        {t.lastEvent.text}
                      </p>
                    )}
                    {t.canReopen && <p className={s.reopen}>Pode ser reaberto pelo funcionário (resolvido há até 7 dias).</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </dialog>
  );
}
