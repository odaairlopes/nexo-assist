import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Bot,
  CheckCheck,
  ChevronLeft,
  CircleCheckBig,
  Hand,
  Headset,
  Info,
  ChevronDown,
  ChevronUp,
  PanelRightClose,
  PanelRightOpen,
  Search,
  SendHorizontal,
  Undo2,
  X,
} from "lucide-react";
import {
  formatLocalTime,
  isSameLocalDay,
  type ChatMessage,
  type ConversationView,
  type SessionUser,
  type TransferKind,
} from "@nexo/shared";
import { ApiError } from "../../api/client.ts";
import { consoleApi } from "../../api/endpoints.ts";
import { DecisionDetails } from "../../components/decision/DecisionDetails.tsx";
import {
  Avatar,
  Button,
  ErrorBanner,
  Pill,
  Spinner,
} from "../../components/ui.tsx";
import type { LiveTurn } from "../../hooks/useConversationState.ts";
import { useStickToBottom } from "../../hooks/useStickToBottom.ts";
import { useTypingNotifier } from "../../hooks/useTyping.ts";
import { HeaderMenu, type MenuAction } from "./HeaderMenu.tsx";
import { containsQuery, highlight } from "./highlight.tsx";
import s from "./Console.module.css";

const TRANSFER_REASON: Record<TransferKind, string> = {
  requested: "Funcionário pediu um analista",
  critical: "Caso crítico",
  overdue: "Chamado com prazo vencido",
  low_confidence: "Agent sem segurança para decidir",
  agent_error: "Falha do agent",
};

function Message({
  m,
  query = "",
  current = false,
}: {
  m: ChatMessage;
  /** Busca ativa: destaca as ocorrências no texto. */
  query?: string;
  /** É a ocorrência em foco na busca. */
  current?: boolean;
}) {
  const time = formatLocalTime(new Date(m.createdAt));
  const content = highlight(m.content, query, current ? s.markCurrent : s.mark);
  if (m.role === "system") {
    return (
      <div className={s.system} role="status">
        <span>
          <Info size={13} aria-hidden="true" /> {content}
        </span>
      </div>
    );
  }
  if (m.role === "user") {
    return (
      <div className={s.clientMsg}>
        <div className={s.bubble} data-kind="client">
          <span>{content}</span>
          <span className={s.time}>{time}</span>
        </div>
      </div>
    );
  }
  const isAgent = m.role === "agent";
  return (
    <div className={s.outMsg}>
      <div className={s.sender}>
        <strong>{isAgent ? "Nexo Assist" : m.author?.name}</strong>
        <span className={s.senderTag} data-kind={isAgent ? "ai" : "human"}>
          {isAgent ? "IA" : "Analista"}
        </span>
      </div>
      <div className={s.bubble} data-kind={isAgent ? "agent" : "human"}>
        <span>{content}</span>
        {m.ui.length > 0 && (
          <span className={s.uiNote}>
            {m.ui
              .map((b) =>
                b.kind === "ticket"
                  ? `card ${b.ticket.id}`
                  : b.kind === "draft"
                    ? `rascunho ${b.draft.code} (${b.draft.status === "confirmed" ? `confirmado → ${b.draft.ticketId}` : b.draft.status})`
                    : b.kind === "ticket_selector"
                      ? `seletor: ${b.tickets.map((t) => t.id).join(", ")}`
                      : b.options.length > 0
                        ? `opções: ${b.options.map((o) => o.label).join(" | ")}`
                        : b.question
                          ? `perguntou: ${b.question}`
                          : "",
              )
              .filter(Boolean)
              .join(" · ")}
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
  onBack = null,
  historyOpen,
  onToggleHistory,
}: {
  conversation: ConversationView;
  messages: ChatMessage[];
  live: LiveTurn | null;
  /** Funcionário digitando agora (nome), se houver. */
  typingName?: string | null;
  me: SessionUser;
  onChanged: (c: ConversationView) => void;
  /** Celular: volta para a lista de conversas. */
  onBack?: (() => void) | null;
  historyOpen: boolean;
  onToggleHistory: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const { scrollToBottom, follow } = useStickToBottom(scrollRef, contentRef);
  useLayoutEffect(follow, [follow, messages, live, typingName]);
  const mine =
    conversation.status === "human" &&
    conversation.assignedAnalyst?.email === me.email;
  const notifyTyping = useTypingNotifier(conversation.id, mine);
  const first = conversation.employee.name.split(" ")[0];

  // ---- Busca dentro da conversa ----
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const matches = query.trim()
    ? messages.filter((m) => containsQuery(m.content, query)).map((m) => m.id)
    : [];
  const currentMatch = matches[cursor] ?? null;

  // Nova busca: começa pela ocorrência mais recente (a de baixo).
  useEffect(() => {
    setCursor(Math.max(0, matches.length - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao mudar o texto buscado
  }, [query]);

  useEffect(() => {
    if (!currentMatch) return;
    contentRef.current
      ?.querySelector(`[data-msg-id="${currentMatch}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentMatch]);

  // Trocou de conversa: fecha a busca.
  useEffect(() => {
    setSearchOpen(false);
    setQuery("");
  }, [conversation.id]);

  function openSearch() {
    setSearchOpen(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  }
  function closeSearch() {
    setSearchOpen(false);
    setQuery("");
  }
  function step(delta: number) {
    if (matches.length === 0) return;
    setCursor((c) => (c + delta + matches.length) % matches.length);
  }

  const giveBack = () =>
    act("return", () => consoleApi.giveBack(conversation.id));
  const closeConversation = () =>
    act("close", () => consoleApi.close(conversation.id));
  const menuActions: MenuAction[] = [
    {
      id: "history",
      label: historyOpen
        ? `Esconder chamados de ${first}`
        : `Ver chamados de ${first}`,
      icon: historyOpen ? (
        <PanelRightClose size={16} />
      ) : (
        <PanelRightOpen size={16} />
      ),
      onSelect: onToggleHistory,
    },
  ];

  // Trocou de conversa: começa no fim. O resto (mensagens, digitando…) o hook acompanha.
  useEffect(() => {
    scrollToBottom();
  }, [conversation.id, scrollToBottom]);

  async function act(
    name: string,
    fn: () => Promise<{ conversation: ConversationView }>,
  ) {
    setBusy(name);
    setError(null);
    try {
      onChanged((await fn()).conversation);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Não foi possível concluir a ação.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    setBusy("send");
    setError(null);
    try {
      await consoleApi.send(conversation.id, content);
      scrollToBottom();
      setText("");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Não foi possível enviar.",
      );
    } finally {
      setBusy(null);
    }
  }

  const transfer = conversation.transfer;
  const firstDay = messages[0] ? new Date(messages[0].createdAt) : null;

  return (
    <section
      className={s.pane}
      aria-label={`Conversa com ${conversation.employee.name}`}
    >
      <header className={s.paneHeader}>
        {onBack && (
          <button
            type="button"
            className={s.backButton}
            onClick={onBack}
            aria-label="Voltar para as conversas"
          >
            <ChevronLeft size={22} />
          </button>
        )}
        <Avatar
          name={conversation.employee.name}
          size={40}
          online={conversation.employeeOnline}
        />
        <div className={s.who}>
          <strong>{conversation.employee.name}</strong>
          <span>
            {conversation.employeeOnline && (
              <span className={s.onlineText}>online · </span>
            )}
            {conversation.employee.department}
            {conversation.ticketRef ? ` · ${conversation.ticketRef}` : ""}
          </span>
        </div>
        {conversation.status === "waiting_human" && (
          <span className={s.headerPill}>
            <Pill tone="warning" icon={<Bot size={14} />}>
              Aguardando atendente
            </Pill>
          </span>
        )}
        {conversation.status === "agent" && (
          <span className={s.headerPill}>
            <Pill tone="success">Agent atendendo</Pill>
          </span>
        )}
        {conversation.status === "closed" && (
          <span className={s.headerPill}>
            <Pill tone="primary">Encerrada</Pill>
          </span>
        )}
        {conversation.status === "human" && !mine && (
          <span className={s.headerPill}>
            <Pill tone="primary">Com {conversation.assignedAnalyst?.name}</Pill>
          </span>
        )}
        {mine && (
          <>
            <Button
              icon={<Bot size={14} />}
              loading={busy === "return"}
              onClick={() => void giveBack()}
              aria-label="Devolver ao agent"
              title="Devolver ao agent"
              className={s.headerAction}
            >
              <span className="hide-sm">Devolver ao agent</span>
            </Button>
            <Button
              variant="danger"
              icon={<CircleCheckBig size={14} />}
              loading={busy === "close"}
              onClick={() => void closeConversation()}
              aria-label="Encerrar atendimento"
              title="Encerrar atendimento"
              className={s.headerAction}
            >
              <span className="hide-sm">Encerrar atendimento</span>
            </Button>
          </>
        )}
        <button
          type="button"
          className={s.iconButton}
          onClick={() => (searchOpen ? closeSearch() : openSearch())}
          aria-pressed={searchOpen}
          aria-label="Buscar na conversa"
          title="Buscar na conversa"
        >
          <Search size={18} />
        </button>
        <HeaderMenu
          actions={menuActions}
          label={`Opções da conversa com ${first}`}
        />
      </header>

      {searchOpen && (
        <div className={s.convSearch} role="search">
          <Search size={15} aria-hidden="true" />
          <label htmlFor="conv-search" className="sr-only">
            Buscar nesta conversa
          </label>
          <input
            id="conv-search"
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeSearch();
              if (e.key === "Enter") {
                e.preventDefault();
                step(e.shiftKey ? 1 : -1);
              }
            }}
            placeholder={`Buscar na conversa com ${first}`}
            autoComplete="off"
          />
          <span className={s.convSearchCount} aria-live="polite">
            {query.trim()
              ? matches.length
                ? `${cursor + 1} de ${matches.length}`
                : "Nada encontrado"
              : ""}
          </span>
          <button
            type="button"
            className={s.iconButton}
            onClick={() => step(-1)}
            disabled={matches.length < 2}
            aria-label="Ocorrência anterior"
          >
            <ChevronUp size={17} />
          </button>
          <button
            type="button"
            className={s.iconButton}
            onClick={() => step(1)}
            disabled={matches.length < 2}
            aria-label="Próxima ocorrência"
          >
            <ChevronDown size={17} />
          </button>
          <button
            type="button"
            className={s.iconButton}
            onClick={closeSearch}
            aria-label="Fechar busca"
          >
            <X size={17} />
          </button>
        </div>
      )}

      <div className={s.paneMessages} ref={scrollRef}>
        <div className={s.paneInner} ref={contentRef}>
          {firstDay && (
            <div className={s.day}>
              <span>
                {isSameLocalDay(firstDay, new Date())
                  ? "Hoje"
                  : firstDay.toLocaleDateString("pt-BR")}
              </span>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} data-msg-id={m.id}>
              <Message
                m={m}
                query={searchOpen ? query : ""}
                current={m.id === currentMatch}
              />
            </div>
          ))}
          {typingName && !live && (
            <div className={s.clientMsg} aria-live="polite">
              <div className={s.bubble} data-kind="client">
                <span
                  className={s.typingBubble}
                  aria-label={`${typingName} está digitando`}
                >
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
                  <Spinner size={10} />{" "}
                  {live.actions.at(-1)?.label ?? "pensando"}…
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className={s.takeover}>
        {error && <ErrorBanner message={error} />}

        {conversation.status === "waiting_human" && transfer && (
          <div className={s.summary}>
            <strong>Resumo do agent · {TRANSFER_REASON[transfer.kind]}</strong>
            <p>{transfer.summary}</p>
            <span>
              {transfer.reason}
              {transfer.confidence !== null &&
                ` · confiança ${Math.round(transfer.confidence * 100)}%`}{" "}
              · fila Suporte {transfer.queue}
            </span>
          </div>
        )}

        {(conversation.status === "waiting_human" ||
          conversation.status === "agent") && (
          <>
            <div className={s.takeoverRow}>
              <span
                className={s.iconWrap}
                data-tone={
                  conversation.status === "agent" ? "success" : "warning"
                }
              >
                <Hand size={17} aria-hidden="true" />
              </span>
              <div className={s.takeoverText}>
                <strong>
                  {conversation.status === "waiting_human"
                    ? `${first} espera um atendente`
                    : `O agent está atendendo ${first}`}
                </strong>
                <span>
                  {conversation.status === "waiting_human"
                    ? `Agent pausado · desde ${transfer ? formatLocalTime(new Date(transfer.at)) : "—"}`
                    : "Você pode assumir a qualquer momento; o agent pausa na hora."}
                </span>
              </div>
              {conversation.status === "waiting_human" && (
                <Button
                  icon={<Undo2 size={15} />}
                  loading={busy === "return"}
                  onClick={() =>
                    act("return", () => consoleApi.giveBack(conversation.id))
                  }
                >
                  Devolver ao agent
                </Button>
              )}
              <Button
                variant="primary"
                icon={<Headset size={16} />}
                loading={busy === "take"}
                onClick={() =>
                  act("take", () => consoleApi.take(conversation.id))
                }
              >
                Assumir atendimento
              </Button>
            </div>
            <div className={s.lockedInput}>
              Assuma o atendimento para responder
            </div>
          </>
        )}

        {conversation.status === "human" && mine && (
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
              autoFocus={window.matchMedia("(pointer: fine)").matches}
            />
            <button
              type="submit"
              className={s.sendRound}
              disabled={!text.trim() || busy === "send"}
              aria-label="Enviar"
            >
              {busy === "send" ? (
                <Spinner size={14} />
              ) : (
                <SendHorizontal size={18} />
              )}
            </button>
          </form>
        )}

        {conversation.status === "human" && !mine && (
          <div className={s.lockedInput}>
            {conversation.assignedAnalyst?.name} está atendendo esta conversa.
          </div>
        )}
        {conversation.status === "closed" && (
          <div className={s.lockedInput}>Atendimento encerrado.</div>
        )}
      </footer>
    </section>
  );
}
