import type { Impact, Priority, TicketType } from '../domain.ts';

export interface PriorityInput {
  type: TicketType;
  /** Quantas pessoas são afetadas. */
  impact: Impact;
  /** O problema impede o trabalho (algo "parado", sem alternativa)? */
  blocksWork: boolean;
  /** Existe um compromisso em risco ainda hoje? */
  sameDayCommitment: boolean;
}

export interface PriorityDecision {
  priority: Priority;
  /** Regra do Anexo A que levou à prioridade — vai para o trace e para o analista. */
  rule: string;
}

/**
 * Matriz impacto × urgência do Anexo A, implementada de forma determinística.
 *
 * Decisão: o LLM extrai os *fatos* (quem é afetado, se está parado, se há
 * compromisso hoje) e o código aplica a regra. Assim a prioridade é
 * reprodutível, testável e não depende do humor do modelo.
 */
export function classifyPriority(input: PriorityInput): PriorityDecision {
  const { impact, blocksWork, sameDayCommitment, type } = input;

  if (blocksWork && impact !== 'me') {
    return {
      priority: 'critical',
      rule: impact === 'company' ? 'Algo parado para a empresa' : 'Algo parado para uma equipe',
    };
  }
  if (blocksWork) {
    return { priority: 'high', rule: 'Impede uma pessoa de trabalhar' };
  }
  if (sameDayCommitment) {
    return { priority: 'high', rule: 'Há um compromisso em risco no mesmo dia' };
  }
  if (type === 'REQ') {
    return { priority: 'low', rule: 'Pedido sem urgência' };
  }
  return { priority: 'medium', rule: 'Atrapalha, mas há alternativa' };
}
