import {
  formatLocalDateTime,
  formatLocalDay,
  formatRelative,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  type TicketSummary,
  type TicketView,
} from '@nexo/shared';
import { Dot } from '../../../components/ui.tsx';
import s from './cards.module.css';

function categoryText(t: TicketSummary) {
  return t.subcategory ? `${t.category} › ${t.subcategory}` : t.category;
}

export function TicketCard({ ticket }: { ticket: TicketView }) {
  const statusTone = ticket.sla.overdue ? 'warning' : STATUS_TONE[ticket.status];
  return (
    <article className={s.card} aria-label={`Chamado ${ticket.id}`}>
      <div className={s.body}>
        <div className={s.eyebrow}>
          <span className={s.eyebrowLabel}>Chamado</span>
          <span className={s.sep} aria-hidden="true" />
          <span>{ticket.id}</span>
          <span className={s.flex} />
          <span className={s.state} data-tone={statusTone}>
            <Dot tone={STATUS_TONE[ticket.status]} />
            {STATUS_LABEL[ticket.status]}
          </span>
        </div>
        <h3 className={s.title}>{ticket.title}</h3>
        <p className={s.description}>{ticket.description}</p>
      </div>
      <div className={s.fields}>
        <div className={s.grid}>
          <Field label="Categoria">{categoryText(ticket)}</Field>
          <Field label="Prioridade">
            <Dot tone={PRIORITY_TONE[ticket.priority]} />
            {PRIORITY_LABEL[ticket.priority]}
          </Field>
          <Field label="Aberto em">{formatLocalDateTime(new Date(ticket.createdAt))}</Field>
          <Field label="Última atualização">
            <span className={ticket.sla.overdue ? s.overdue : undefined}>{formatRelative(ticket.updatedAt)}</span>
            {ticket.sla.overdue && <span className={s.muted}>· prazo vencido</span>}
            {!ticket.sla.overdue && ticket.sla.dueAt && (
              <span className={s.muted}>· prazo {formatLocalDay(new Date(ticket.sla.dueAt))}</span>
            )}
          </Field>
        </div>
      </div>
    </article>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={s.field}>
      <span className={s.fieldLabel}>{label}</span>
      <span className={s.fieldValue}>{children}</span>
    </div>
  );
}

export function TicketSelector({
  tickets,
  disabled,
  onSelect,
}: {
  tickets: TicketSummary[];
  disabled: boolean;
  onSelect: (t: TicketSummary) => void;
}) {
  return (
    <div className={s.card} role="radiogroup" aria-label="Escolha um chamado">
      {tickets.map((t, i) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={false}
          className={s.selectorRow}
          data-first={i === 0}
          disabled={disabled}
          onClick={() => onSelect(t)}
        >
          <span className={s.radio} aria-hidden="true" />
          <span className={s.selectorId}>{t.id}</span>
          <span className={s.selectorTitle}>{t.title}</span>
          <span className={s.selectorStatus}>
            <Dot tone={t.sla.overdue ? 'warning' : STATUS_TONE[t.status]} />
            {STATUS_LABEL[t.status]}
            {t.sla.overdue && <span className={s.overdueTag}>vencido</span>}
          </span>
          <span className={s.selectorDate}>{formatLocalDay(new Date(t.createdAt))}</span>
        </button>
      ))}
    </div>
  );
}

export function QuickOptions({
  question,
  options,
  numbered,
  disabled,
  onPick,
}: {
  question: string | null;
  options: { label: string; value: string }[];
  numbered: boolean;
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <>
      {question && <p className={s.question}>{question}</p>}
      {options.length > 0 && (
        <div className={s.options} role="group" aria-label={question ?? 'Respostas rápidas'}>
          {options.map((o, i) => (
            <button key={o.label} type="button" className={s.option} disabled={disabled} onClick={() => onPick(o.value)}>
              {numbered && (
                <kbd className={s.key} aria-hidden="true">
                  {i + 1}
                </kbd>
              )}
              {o.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
