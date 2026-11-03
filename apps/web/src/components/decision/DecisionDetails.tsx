import { useId, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ShieldCheck, X } from 'lucide-react';
import type { AgentAction, AgentTrace, Intent } from '@nexo/shared';
import s from './DecisionDetails.module.css';

export const INTENT_LABEL: Record<Intent, string> = {
  question: 'Tirar uma dúvida',
  ticket_status: 'Saber o status de um chamado',
  ticket_update: 'Complementar um chamado',
  new_ticket: 'Abrir um chamado',
  talk_to_human: 'Falar com um analista',
  confirm: 'Confirmar',
  cancel: 'Cancelar',
  out_of_scope: 'Assunto fora de TI',
  greeting: 'Cumprimento',
  unclear: 'Não ficou claro',
};

export const ACTION_LABEL: Record<AgentAction, string> = {
  answered_from_kb: 'Respondeu com a central de ajuda',
  answered: 'Respondeu',
  asked_clarification: 'Pediu mais informação',
  listed_tickets: 'Listou os chamados',
  showed_ticket: 'Mostrou o chamado',
  drafted_ticket: 'Montou rascunho de chamado',
  drafted_update: 'Montou rascunho de atualização',
  confirmed_draft: 'Executou o rascunho confirmado',
  transferred: 'Transferiu para um analista',
  redirected_out_of_scope: 'Redirecionou para outra área',
  offered_options: 'Ofereceu opções',
};

function confidenceTone(c: number): 'high' | 'mid' | 'low' {
  if (c >= 0.75) return 'high';
  if (c >= 0.5) return 'mid';
  return 'low';
}

/** Resumo de uma linha usado no botão: "Abrir um chamado · 86%". */
export function decisionSummary(trace: AgentTrace): string {
  return `${INTENT_LABEL[trace.intent]} · ${Math.round(trace.confidence * 100)}%`;
}

function Json({ value }: { value: unknown }) {
  return <pre className={s.json}>{JSON.stringify(value, null, 2)}</pre>;
}

/**
 * "O que o agent entendeu, que ação tomou, com que grau de segurança e por quê."
 * Exibido sob demanda abaixo das ações de cada resposta.
 */
export function DecisionDetails({ trace, compact = false }: { trace: AgentTrace; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const pct = Math.round(trace.confidence * 100);
  const tone = confidenceTone(trace.confidence);

  return (
    <div className={s.wrap} data-compact={compact}>
      <button type="button" className={s.toggle} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
        <span className={s.meter} data-tone={tone} aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
        Por quê? <span className={s.toggleMuted}>{decisionSummary(trace)}</span>
        <ChevronDown size={13} className={s.chevron} data-open={open} aria-hidden="true" />
      </button>

      {open && (
        <section id={panelId} className={s.panel} aria-label="Detalhes da decisão do agent">
          <dl className={s.rows}>
            <div>
              <dt>Entendi</dt>
              <dd>{trace.understood}</dd>
            </div>
            <div>
              <dt>Intenção</dt>
              <dd>{INTENT_LABEL[trace.intent]}</dd>
            </div>
            <div>
              <dt>Ação</dt>
              <dd>{ACTION_LABEL[trace.action]}</dd>
            </div>
            <div>
              <dt>Confiança</dt>
              <dd className={s.confidence}>
                <span className={s.bar} data-tone={tone} role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <span style={{ width: `${pct}%` }} />
                </span>
                <strong>{pct}%</strong>
                <span className={s.muted}>{tone === 'high' ? 'alta' : tone === 'mid' ? 'média — confirma antes de agir' : 'baixa — chama um analista'}</span>
              </dd>
            </div>
            <div>
              <dt>Por quê</dt>
              <dd>{trace.reasoning}</dd>
            </div>
          </dl>

          {trace.steps.length > 0 && (
            <div className={s.block}>
              <h4>Passos</h4>
              <ol className={s.steps}>
                {trace.steps.map((step, i) => (
                  <li key={`${step.tool}-${i}`}>
                    <details>
                      <summary>
                        {step.ok ? <Check size={13} className={s.ok} aria-label="ok" /> : <X size={13} className={s.fail} aria-label="falhou" />}
                        <span>{step.label}</span>
                        <code>{step.tool}</code>
                        <span className={s.muted}>{step.durationMs} ms</span>
                      </summary>
                      <div className={s.io}>
                        <div>
                          <span>Entrada</span>
                          <Json value={step.input} />
                        </div>
                        <div>
                          <span>Resultado</span>
                          <Json value={step.output} />
                        </div>
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {trace.guardrails.length > 0 && (
            <div className={s.block}>
              <h4>Regras aplicadas pelo sistema</h4>
              <ul className={s.guards}>
                {trace.guardrails.map((g) => (
                  <li key={g}>
                    <ShieldCheck size={13} aria-hidden="true" />
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {trace.error && (
            <p className={s.error}>
              <AlertTriangle size={13} aria-hidden="true" /> {trace.error}
            </p>
          )}

          <p className={s.footer}>
            {trace.model} · {(trace.latencyMs / 1000).toFixed(1)} s
            {trace.usage && ` · ${trace.usage.inputTokens + trace.usage.outputTokens} tokens (${trace.usage.inputTokens} entrada / ${trace.usage.outputTokens} saída)`}
          </p>
        </section>
      )}
    </div>
  );
}
