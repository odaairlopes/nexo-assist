import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CATEGORIES, formatLocalDateTime, formatLocalTime, IMPACT_LABEL, isSameLocalDay, PRIORITY_LABEL, PRIORITY_TONE, type Category, type DraftEdit, type DraftView } from '@nexo/shared';
import { Button, Dot } from '../../../components/ui.tsx';
import { Field } from './TicketCard.tsx';
import s from './cards.module.css';

const KIND_LABEL = { create: 'Novo chamado', update: 'Atualizar chamado', reopen: 'Reabrir chamado' } as const;

function dueText(iso: string) {
  const due = new Date(iso);
  return isSameLocalDay(due, new Date()) ? `resposta até ${formatLocalTime(due)}` : `resposta até ${formatLocalDateTime(due)}`;
}

interface Props {
  draft: DraftView;
  /** Só o card mais recente aceita interação. */
  interactive: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => Promise<void>;
  onEdit: (edit: DraftEdit) => Promise<void>;
}

export function DraftCard({ draft, interactive, onConfirm, onCancel, onEdit }: Props) {
  const [busy, setBusy] = useState<'confirm' | 'cancel' | 'edit' | null>(null);
  // Anima só a TRANSIÇÃO para confirmado (não ao recarregar um rascunho já confirmado).
  const initialStatus = useRef(draft.status);
  const justConfirmed = draft.status === 'confirmed' && initialStatus.current !== 'confirmed';
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = draft.status === 'pending';
  const canAct = interactive && pending && busy === null;

  // Atalho ⌘/Ctrl + Enter confirma o rascunho visível.
  useEffect(() => {
    if (!canAct || editing) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void run('confirm', onConfirm);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function run(kind: 'confirm' | 'cancel' | 'edit', fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir.');
    } finally {
      setBusy(null);
    }
  }

  const state =
    draft.status === 'confirmed'
      ? { tone: 'success' as const, text: draft.ticketId ? `Confirmado · ${draft.ticketId}` : 'Confirmado' }
      : draft.status === 'cancelled'
        ? { tone: 'neutral' as const, text: 'Cancelado' }
        : { tone: 'warning' as const, text: 'Aguardando confirmação' };

  return (
    <article
      className={s.card}
      data-muted={draft.status === 'cancelled'}
      data-status={justConfirmed ? 'confirmed' : undefined}
      aria-label={`Rascunho ${draft.code}`}
    >
      <div className={s.body}>
        <div className={s.eyebrow}>
          <span className={s.eyebrowLabel}>{KIND_LABEL[draft.kind]}</span>
          <span className={s.sep} aria-hidden="true" />
          <span>Rascunho {draft.code}</span>
          {draft.ticketId && draft.kind !== 'create' && (
            <>
              <span className={s.sep} aria-hidden="true" />
              <span>{draft.ticketId}</span>
            </>
          )}
          <span className={s.flex} />
          <span className={s.state} data-tone={state.tone}>
            <Dot tone={state.tone} />
            {state.text}
          </span>
        </div>

        {editing ? (
          <EditForm
            draft={draft}
            busy={busy === 'edit'}
            onCancel={() => setEditing(false)}
            onSave={(edit) =>
              run('edit', async () => {
                await onEdit(edit);
                setEditing(false);
              })
            }
          />
        ) : (
          <>
            <h3 className={s.title}>{draft.title}</h3>
            {draft.kind === 'create' ? (
              <p className={s.description}>{draft.description}</p>
            ) : (
              <p className={s.description}>
                <span className={s.muted}>Será adicionado ao chamado: </span>
                {draft.comment}
              </p>
            )}
          </>
        )}
      </div>

      {!editing && (
        <div className={s.fields}>
          <div className={s.grid}>
            <Field label="Categoria">{draft.category}</Field>
            <Field label="Prioridade">
              <Dot tone={PRIORITY_TONE[draft.priority]} />
              {PRIORITY_LABEL[draft.priority]}
              {pending && <span className={s.muted}>· {dueText(draft.dueAt)}</span>}
            </Field>
            <Field label="Afetados">{IMPACT_LABEL[draft.affected]}</Field>
          </div>
          <p className={s.rule}>
            Por que {PRIORITY_LABEL[draft.priority].toLowerCase()}: {draft.priorityRule} · prazo de {draft.slaLabel}
          </p>
        </div>
      )}

      {(draft.error || error) && pending && (
        <p className={s.cardError} role="alert">
          {error ?? draft.error}
        </p>
      )}

      {pending && interactive && !editing && (
        <div className={s.actions}>
          <button type="button" className={s.confirm} disabled={!canAct} onClick={() => run('confirm', onConfirm)}>
            {busy === 'confirm' ? 'Confirmando…' : 'Confirmar'}
            <kbd className={s.kbd} aria-label="atalho Ctrl ou Cmd mais Enter">
              ⌘↵
            </kbd>
          </button>
          <Button disabled={!canAct} onClick={() => setEditing(true)}>
            Editar
          </Button>
          <Button variant="ghost" disabled={!canAct} loading={busy === 'cancel'} onClick={() => run('cancel', onCancel)}>
            Cancelar
          </Button>
        </div>
      )}
    </article>
  );
}

function EditForm({
  draft,
  busy,
  onSave,
  onCancel,
}: {
  draft: DraftView;
  busy: boolean;
  onSave: (edit: DraftEdit) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [description, setDescription] = useState(draft.kind === 'create' ? draft.description : (draft.comment ?? ''));
  const [category, setCategory] = useState<Category>(draft.category);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (draft.kind === 'create') onSave({ title, description, category });
    else onSave({ comment: description });
  }

  return (
    <form className={s.editForm} onSubmit={submit}>
      {draft.kind === 'create' && (
        <label>
          <span>Título</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} minLength={5} maxLength={120} required />
        </label>
      )}
      <label>
        <span>{draft.kind === 'create' ? 'Descrição' : 'Informação a adicionar'}</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} minLength={10} maxLength={2000} required />
      </label>
      {draft.kind === 'create' && (
        <label>
          <span>Categoria</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      )}
      <p className={s.muted}>A prioridade segue as regras do service desk e não é editável aqui.</p>
      <div className={s.editActions}>
        <Button variant="primary" type="submit" loading={busy}>
          Salvar
        </Button>
        <Button variant="ghost" type="button" onClick={onCancel}>
          Voltar
        </Button>
      </div>
    </form>
  );
}
