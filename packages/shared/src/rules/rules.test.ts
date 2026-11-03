import { describe, expect, it } from 'vitest';
import { addBusinessMinutes, businessMinutesBetween, formatLocalTime } from './business-hours.ts';
import { classifyPriority } from './priority.ts';
import { canReopen, computeDueDate, computeSlaStatus } from './sla.ts';
import { DUPLICATE_BLOCK_THRESHOLD, DUPLICATE_WARN_THRESHOLD, ticketSimilarity } from './similarity.ts';

// Horários em BRT (UTC-3). 2026-10-20 é uma terça-feira.
const brt = (iso: string) => new Date(`${iso}-03:00`);

describe('business hours', () => {
  it('soma dentro do mesmo dia', () => {
    expect(addBusinessMinutes(brt('2026-10-20T09:43'), 240)).toEqual(brt('2026-10-20T13:43'));
  });

  it('atravessa a noite', () => {
    expect(addBusinessMinutes(brt('2026-10-20T16:00'), 240)).toEqual(brt('2026-10-21T10:00'));
  });

  it('começa no próximo expediente quando aberto fora do horário', () => {
    expect(addBusinessMinutes(brt('2026-10-20T21:30'), 60)).toEqual(brt('2026-10-21T09:00'));
  });

  it('pula o fim de semana (sexta 17h + 4h úteis = segunda 11h)', () => {
    expect(addBusinessMinutes(brt('2026-10-23T17:00'), 240)).toEqual(brt('2026-10-26T11:00'));
  });

  it('conta minutos úteis entre dois instantes', () => {
    expect(businessMinutesBetween(brt('2026-10-23T17:00'), brt('2026-10-26T09:00'))).toBe(120);
  });

  it('formata no horário de Brasília', () => {
    expect(formatLocalTime(new Date('2026-10-20T16:43:00Z'))).toBe('13:43');
  });
});

describe('classifyPriority (Anexo A)', () => {
  it('crítica quando algo está parado para uma equipe', () => {
    expect(classifyPriority({ type: 'INC', impact: 'team', blocksWork: true, sameDayCommitment: false }).priority).toBe('critical');
  });

  it('crítica quando parado para a empresa', () => {
    expect(classifyPriority({ type: 'INC', impact: 'company', blocksWork: true, sameDayCommitment: false }).priority).toBe('critical');
  });

  it('alta quando impede uma pessoa de trabalhar', () => {
    expect(classifyPriority({ type: 'INC', impact: 'me', blocksWork: true, sameDayCommitment: false }).priority).toBe('high');
  });

  it('alta quando há compromisso no mesmo dia (caso da VPN antes da reunião)', () => {
    const d = classifyPriority({ type: 'INC', impact: 'me', blocksWork: false, sameDayCommitment: true });
    expect(d.priority).toBe('high');
    expect(d.rule).toMatch(/compromisso/);
  });

  it('média quando atrapalha mas há alternativa', () => {
    expect(classifyPriority({ type: 'INC', impact: 'me', blocksWork: false, sameDayCommitment: false }).priority).toBe('medium');
  });

  it('equipe afetada sem estar parada não é crítica', () => {
    expect(classifyPriority({ type: 'INC', impact: 'team', blocksWork: false, sameDayCommitment: false }).priority).toBe('medium');
  });

  it('baixa para pedidos sem urgência', () => {
    expect(classifyPriority({ type: 'REQ', impact: 'me', blocksWork: false, sameDayCommitment: false }).priority).toBe('low');
  });
});

describe('SLA', () => {
  it('crítica conta 1 hora corrida (plantão 24h)', () => {
    expect(computeDueDate('critical', brt('2026-10-24T22:00'))).toEqual(brt('2026-10-24T23:00'));
  });

  it('média vence em 3 dias úteis', () => {
    expect(computeDueDate('medium', brt('2026-10-16T14:20'))).toEqual(brt('2026-10-21T14:20'));
  });

  it('marca como vencido o chamado sem atualização além do prazo', () => {
    const sla = computeSlaStatus(
      { priority: 'medium', status: 'waiting_analyst', updatedAt: brt('2026-10-16T14:20').toISOString() },
      brt('2026-10-21T15:00'),
    );
    expect(sla.overdue).toBe(true);
    expect(sla.policyLabel).toBe('3 dias úteis');
  });

  it('não corre prazo para chamado resolvido ou aprovado', () => {
    expect(computeSlaStatus({ priority: 'low', status: 'approved', updatedAt: brt('2026-01-01T10:00').toISOString() }).running).toBe(
      false,
    );
  });

  it('permite reabrir apenas até 7 dias após resolvido', () => {
    const now = brt('2026-10-20T10:00');
    expect(canReopen({ status: 'resolved', resolvedAt: brt('2026-10-16T10:00').toISOString() }, now)).toBe(true);
    expect(canReopen({ status: 'resolved', resolvedAt: brt('2026-10-10T10:00').toISOString() }, now)).toBe(false);
    expect(canReopen({ status: 'in_progress', resolvedAt: null }, now)).toBe(false);
  });
});

describe('ticketSimilarity (duplicidade)', () => {
  const lento = {
    title: 'Notebook lento após atualização do Windows',
    description: 'Lentidão geral desde a atualização de 15/10.',
    category: 'Hardware' as const,
  };

  it('reconhece o mesmo problema descrito com outras palavras', () => {
    const novo = { title: 'Notebook muito lento', description: 'Depois da atualização do Windows ficou lento', category: 'Hardware' as const };
    expect(ticketSimilarity(lento, novo)).toBeGreaterThanOrEqual(DUPLICATE_BLOCK_THRESHOLD);
  });

  it('não confunde problemas diferentes', () => {
    const vpn = { title: 'VPN não conecta — erro 809', description: 'Windows 11 não conecta na VPN', category: 'Rede e VPN' as const };
    expect(ticketSimilarity(lento, vpn)).toBeLessThan(DUPLICATE_WARN_THRESHOLD);
  });
});
