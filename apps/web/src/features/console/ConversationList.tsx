import { useMemo, useState } from 'react';
import { CheckCheck, Search } from 'lucide-react';
import { formatLocalTime, isSameLocalDay, type ConversationView, type SessionUser } from '@nexo/shared';
import { Avatar, Dot, Pill } from '../../components/ui.tsx';
import type { TypingInfo } from '../../hooks/useTyping.ts';
import s from './Console.module.css';

export type Filter = 'all' | 'needs_you' | 'agent' | 'mine';

/**
 * Mantém conversas abertas e, de cada pessoa, a mais recente. Sessões
 * encerradas antigas da mesma pessoa saem da lista (continuam no banco).
 */
export function latestPerEmployee(conversations: ConversationView[]): ConversationView[] {
  const newest = new Map<string, string>();
  for (const c of conversations) {
    const seen = newest.get(c.employee.email);
    if (!seen || c.updatedAt > seen) newest.set(c.employee.email, c.updatedAt);
  }
  return conversations.filter((c) => c.status !== 'closed' || newest.get(c.employee.email) === c.updatedAt);
}

export function matchesFilter(c: ConversationView, filter: Filter, me: SessionUser): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'needs_you':
      return c.status === 'waiting_human';
    case 'agent':
      return c.status === 'agent';
    case 'mine':
      return c.status === 'human' && c.assignedAnalyst?.email === me.email;
  }
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (isSameLocalDay(d, new Date())) {
    const diff = Date.now() - d.getTime();
    return diff < 60_000 ? 'agora' : formatLocalTime(d);
  }
  return isSameLocalDay(d, new Date(Date.now() - 86_400_000)) ? 'ontem' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

/** Etiqueta de status da conversa, como no protótipo. */
function Tag({ c, me }: { c: ConversationView; me: SessionUser }) {
  if (c.status === 'waiting_human' && c.transfer) {
    if (c.transfer.kind === 'low_confidence' || c.transfer.kind === 'agent_error') {
      return (
        <span className={s.tag} data-tone="warning">
          <Dot tone="warning" />
          Agent pediu ajuda{c.transfer.confidence !== null ? ` · confiança ${Math.round(c.transfer.confidence * 100)}%` : ''}
        </span>
      );
    }
    return (
      <span className={s.tag} data-tone="danger">
        <Dot tone="danger" />
        Transferida{c.transfer.ticketId ? ` · ${c.transfer.ticketId}` : ''}
        {c.transfer.kind === 'critical' ? ' · crítico' : c.transfer.kind === 'overdue' ? ' · vencido' : ''}
      </span>
    );
  }
  if (c.status === 'human') {
    const mine = c.assignedAnalyst?.email === me.email;
    return (
      <span className={s.tag} data-tone="primary">
        <Dot tone="primary" />
        {mine ? 'Você está atendendo' : `Com ${c.assignedAnalyst?.name}`}
      </span>
    );
  }
  if (c.status === 'agent') {
    return (
      <span className={s.tag}>
        <Dot tone="success" />
        Agent atendendo
      </span>
    );
  }
  return (
    <span className={s.tag}>
      <Dot tone="neutral" />
      {c.transfer || c.assignedAnalyst ? 'Encerrada' : 'Resolvida pelo agent'}
    </span>
  );
}

export function ConversationList({
  conversations,
  selectedId,
  me,
  typing,
  onSelect,
}: {
  conversations: ConversationView[];
  selectedId: string | null;
  me: SessionUser;
  /** Quem está digitando, por conversa. */
  typing: Record<string, TypingInfo>;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>('needs_you');
  const [query, setQuery] = useState('');

  // Uma linha por pessoa: sessões encerradas somem quando há uma conversa mais nova da mesma pessoa.
  const current = useMemo(() => latestPerEmployee(conversations), [conversations]);

  const counts = useMemo(() => {
    const c = { all: current.length, needs_you: 0, agent: 0, mine: 0 };
    for (const conv of current) {
      if (matchesFilter(conv, 'needs_you', me)) c.needs_you++;
      if (matchesFilter(conv, 'agent', me)) c.agent++;
      if (matchesFilter(conv, 'mine', me)) c.mine++;
    }
    return c;
  }, [current, me]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return current
      .filter((c) => matchesFilter(c, filter, me))
      .filter(
        (c) =>
          !q ||
          c.employee.name.toLowerCase().includes(q) ||
          (c.ticketRef ?? '').toLowerCase().includes(q) ||
          (c.lastMessage?.content ?? '').toLowerCase().includes(q),
      )
      // Quem espera atendente vem primeiro; depois, as mais recentes.
      .sort((a, b) => Number(b.status === 'waiting_human') - Number(a.status === 'waiting_human') || b.updatedAt.localeCompare(a.updatedAt));
  }, [current, filter, query, me]);

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'Todas' },
    { id: 'needs_you', label: 'Para você' },
    { id: 'agent', label: 'Com o agent' },
    { id: 'mine', label: 'Minhas' },
  ];

  return (
    <section className={s.list} aria-label="Conversas">
      <header className={s.listHeader}>
        <div className={s.titleRow}>
          <h1>Conversas</h1>
          <Pill tone="success">Disponível</Pill>
        </div>
        <label className={s.search}>
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">Pesquisar</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar conversa ou chamado" />
        </label>
        <div className={s.filters} role="tablist" aria-label="Filtros">
          {filters.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={s.filter} onClick={() => setFilter(f.id)}>
              {f.label}
              {f.id !== 'all' && <strong>{counts[f.id]}</strong>}
            </button>
          ))}
        </div>
      </header>

      <ul className={s.items}>
        {visible.length === 0 && <li className={s.emptyList}>Nenhuma conversa neste filtro.</li>}
        {visible.map((c) => {
          const unread = c.pendingUserMessages;
          const typingNow = typing[c.id]?.role === 'user';
          const selected = c.id === selectedId;
          const preview = c.lastMessage
            ? c.lastMessage.role === 'agent'
              ? `Nexo: ${c.lastMessage.content}`
              : c.lastMessage.content
            : 'Sem mensagens ainda';
          return (
            <li key={c.id}>
              <button type="button" className={s.item} data-selected={selected} onClick={() => onSelect(c.id)}>
                <Avatar
                  name={c.employee.name}
                  size={46}
                  online={c.employeeOnline}
                  ringColor={selected ? 'var(--desk)' : 'var(--paper)'}
                />
                <span className={s.itemText}>
                  <span className={s.itemTop}>
                    <strong data-unread={unread > 0}>{c.employee.name}</strong>
                    <span data-unread={unread > 0}>{timeLabel(c.updatedAt)}</span>
                  </span>
                  <span className={s.itemPreview}>
                    {typingNow ? (
                      <span className={s.typingText}>digitando…</span>
                    ) : (
                      <>
                        {c.lastMessage?.role === 'agent' && <CheckCheck size={15} aria-hidden="true" />}
                        <span>{preview}</span>
                      </>
                    )}
                    {unread > 0 && !typingNow && (
                      <span className={s.unread} aria-label={`${unread} não lidas`}>
                        {unread}
                      </span>
                    )}
                  </span>
                  <Tag c={c} me={me} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
