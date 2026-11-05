import { useMemo, useState, type ReactNode } from "react";
import { CheckCheck, Search, X } from "lucide-react";
import {
  formatLocalTime,
  isSameLocalDay,
  type ConversationView,
  type SessionUser,
} from "@nexo/shared";
import { Avatar, Dot, NexoMark, Pill } from "../../components/ui.tsx";
import type { TypingInfo } from "../../hooks/useTyping.ts";
import {
  byRecentActivity,
  FILTERS,
  lastActivity,
  latestPerEmployee,
  matchesFilter,
  matchesQuery,
  type Filter,
} from "./filters.ts";
import s from "./Console.module.css";

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (isSameLocalDay(d, new Date())) {
    const diff = Date.now() - d.getTime();
    return diff < 60_000 ? "agora" : formatLocalTime(d);
  }
  return isSameLocalDay(d, new Date(Date.now() - 86_400_000))
    ? "ontem"
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

/** Etiqueta de status da conversa, como no protótipo. */
function Tag({ c, me }: { c: ConversationView; me: SessionUser }) {
  if (c.status === "waiting_human" && c.transfer) {
    if (
      c.transfer.kind === "low_confidence" ||
      c.transfer.kind === "agent_error"
    ) {
      return (
        <span className={s.tag} data-tone="warning">
          <Dot tone="warning" />
          Agent pediu ajuda
          {c.transfer.confidence !== null
            ? ` · confiança ${Math.round(c.transfer.confidence * 100)}%`
            : ""}
        </span>
      );
    }
    return (
      <span className={s.tag} data-tone="danger">
        <Dot tone="danger" />
        Transferida{c.transfer.ticketId ? ` · ${c.transfer.ticketId}` : ""}
        {c.transfer.kind === "critical"
          ? " · crítico"
          : c.transfer.kind === "overdue"
            ? " · vencido"
            : ""}
      </span>
    );
  }
  if (c.status === "human") {
    const mine = c.assignedAnalyst?.email === me.email;
    return (
      <span className={s.tag} data-tone="primary">
        <Dot tone="primary" />
        {mine ? "Você está atendendo" : `Com ${c.assignedAnalyst?.name}`}
      </span>
    );
  }
  if (c.status === "agent") {
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
      {c.transfer || c.assignedAnalyst ? "Encerrada" : "Resolvida pelo agent"}
    </span>
  );
}

export function ConversationList({
  conversations,
  selectedId,
  me,
  typing,
  onSelect,
  account = null,
}: {
  conversations: ConversationView[];
  selectedId: string | null;
  me: SessionUser;
  /** Quem está digitando, por conversa. */
  typing: Record<string, TypingInfo>;
  onSelect: (id: string) => void;
  /** Conta do analista (sair/avatar): no celular a barra lateral some e isso vem para cá. */
  account?: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>("needs_you");
  const [query, setQuery] = useState("");

  // Uma linha por pessoa: sessões encerradas somem quando há uma conversa mais nova da mesma pessoa.
  const current = useMemo(
    () => latestPerEmployee(conversations),
    [conversations],
  );

  const counts = useMemo(() => {
    const c = { all: current.length, needs_you: 0, agent: 0, mine: 0 };
    for (const conv of current) {
      if (matchesFilter(conv, "needs_you", me)) c.needs_you++;
      if (matchesFilter(conv, "agent", me)) c.agent++;
      if (matchesFilter(conv, "mine", me)) c.mine++;
    }
    return c;
  }, [current, me]);

  const searching = query.trim().length > 0;
  const visible = useMemo(
    () =>
      current
        // Buscando, procura em todas as conversas; sem busca, vale a aba escolhida.
        .filter((c) =>
          searching ? matchesQuery(c, query) : matchesFilter(c, filter, me),
        )
        .sort(byRecentActivity),
    [current, filter, query, searching, me],
  );

  return (
    <section className={s.list} aria-label="Conversas">
      <header className={s.listHeader}>
        <div className={s.titleRow}>
          {account && (
            <span className={s.listMark}>
              <NexoMark size={22} />
            </span>
          )}
          <h1>Conversas</h1>
          <Pill tone="success">Disponível</Pill>
          {account}
        </div>
        <div className={s.search}>
          <Search size={15} aria-hidden="true" />
          <label htmlFor="console-search" className="sr-only">
            Pesquisar conversas
          </label>
          <input
            id="console-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder="Pesquisar conversa ou chamado"
            autoComplete="off"
          />
          {searching && (
            <button
              type="button"
              className={s.searchClear}
              onClick={() => setQuery("")}
              aria-label="Limpar busca"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {!searching && (
          <div className={s.filters} role="tablist" aria-label="Filtros">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                className={s.filter}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                <strong>{counts[f.id]}</strong>
              </button>
            ))}
          </div>
        )}
        {searching && (
          <p className={s.filterHint} aria-live="polite">
            {`${visible.length} ${visible.length === 1 ? "resultado" : "resultados"} em todas as conversas`}
          </p>
        )}
      </header>

      <ul className={s.items}>
        {visible.length === 0 && (
          <li className={s.emptyList}>
            {searching ? (
              <>
                Nada encontrado para “{query.trim()}”.
                <button
                  type="button"
                  className={s.linkButton}
                  onClick={() => setQuery("")}
                >
                  Limpar busca
                </button>
              </>
            ) : (
              "Nenhuma conversa neste filtro."
            )}
          </li>
        )}
        {visible.map((c) => {
          const unread = c.pendingUserMessages;
          const typingNow = typing[c.id]?.role === "user";
          const selected = c.id === selectedId;
          const preview = c.lastMessage
            ? c.lastMessage.role === "agent"
              ? `Nexo: ${c.lastMessage.content}`
              : c.lastMessage.content
            : "Sem mensagens ainda";
          return (
            <li key={c.id}>
              <button
                type="button"
                className={s.item}
                data-selected={selected}
                onClick={() => onSelect(c.id)}
              >
                <Avatar
                  name={c.employee.name}
                  size={46}
                  online={c.employeeOnline}
                  ringColor={selected ? "var(--desk)" : "var(--paper)"}
                />
                <span className={s.itemText}>
                  <span className={s.itemTop}>
                    <strong data-unread={unread > 0}>{c.employee.name}</strong>
                    <span data-unread={unread > 0}>
                      {timeLabel(lastActivity(c))}
                    </span>
                  </span>
                  <span className={s.itemPreview}>
                    {typingNow ? (
                      <span className={s.typingText}>digitando…</span>
                    ) : (
                      <>
                        {c.lastMessage?.role === "agent" && (
                          <CheckCheck size={15} aria-hidden="true" />
                        )}
                        <span>{preview}</span>
                      </>
                    )}
                    {unread > 0 && !typingNow && (
                      <span
                        className={s.unread}
                        aria-label={`${unread} não lidas`}
                      >
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
