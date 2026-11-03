/**
 * Calendário do service desk: segunda a sexta, 8h às 18h, horário de Brasília.
 *
 * Decisão: o Brasil não tem horário de verão desde 2019, então um offset fixo
 * (UTC-3) é suficiente e evita depender de dados de timezone do runtime.
 * Feriados ficaram fora do escopo (ver README → "com mais tempo").
 */
export const BUSINESS_TZ_OFFSET_MINUTES = -180;
export const BUSINESS_START_HOUR = 8;
export const BUSINESS_END_HOUR = 18;
export const BUSINESS_MINUTES_PER_DAY = (BUSINESS_END_HOUR - BUSINESS_START_HOUR) * 60;

const MINUTE = 60_000;

/** Converte um instante UTC numa "data de parede" local (lida com getUTC*). */
function toWall(date: Date): Date {
  return new Date(date.getTime() + BUSINESS_TZ_OFFSET_MINUTES * MINUTE);
}

function fromWall(wall: Date): Date {
  return new Date(wall.getTime() - BUSINESS_TZ_OFFSET_MINUTES * MINUTE);
}

function isBusinessDay(wall: Date): boolean {
  const day = wall.getUTCDay();
  return day !== 0 && day !== 6;
}

function atHour(wall: Date, hour: number): Date {
  const d = new Date(wall);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

/** Próximo instante (em hora de parede) que está dentro do expediente. */
function nextBusinessMoment(wall: Date): Date {
  let cursor = new Date(wall);
  for (let guard = 0; guard < 14; guard++) {
    const start = atHour(cursor, BUSINESS_START_HOUR);
    const end = atHour(cursor, BUSINESS_END_HOUR);
    if (isBusinessDay(cursor)) {
      if (cursor < start) return start;
      if (cursor < end) return cursor;
    }
    cursor = atHour(new Date(cursor.getTime() + 24 * 60 * MINUTE), 0);
  }
  throw new Error('Calendário sem dia útil em 14 dias — configuração inválida');
}

/** Soma minutos úteis a partir de `start`, pulando noites e fins de semana. */
export function addBusinessMinutes(start: Date, minutes: number): Date {
  if (minutes < 0) throw new RangeError('minutes deve ser >= 0');
  let wall = nextBusinessMoment(toWall(start));
  let remaining = minutes;
  while (remaining > 0) {
    const endOfDay = atHour(wall, BUSINESS_END_HOUR);
    const available = (endOfDay.getTime() - wall.getTime()) / MINUTE;
    if (remaining <= available) {
      wall = new Date(wall.getTime() + remaining * MINUTE);
      remaining = 0;
    } else {
      remaining -= available;
      wall = nextBusinessMoment(endOfDay);
    }
  }
  return fromWall(wall);
}

/** Minutos úteis decorridos entre dois instantes (0 se `end` <= `start`). */
export function businessMinutesBetween(start: Date, end: Date): number {
  if (end <= start) return 0;
  let wall = nextBusinessMoment(toWall(start));
  const endWall = toWall(end);
  let total = 0;
  while (wall < endWall) {
    const endOfDay = atHour(wall, BUSINESS_END_HOUR);
    const sliceEnd = endOfDay < endWall ? endOfDay : endWall;
    total += Math.max(0, (sliceEnd.getTime() - wall.getTime()) / MINUTE);
    if (endOfDay >= endWall) break;
    wall = nextBusinessMoment(endOfDay);
  }
  return Math.round(total);
}

export function isWithinBusinessHours(date: Date): boolean {
  const wall = toWall(date);
  const hour = wall.getUTCHours() + wall.getUTCMinutes() / 60;
  return isBusinessDay(wall) && hour >= BUSINESS_START_HOUR && hour < BUSINESS_END_HOUR;
}

/** "13:43" no horário de Brasília. */
export function formatLocalTime(date: Date): string {
  const wall = toWall(date);
  return `${String(wall.getUTCHours()).padStart(2, '0')}:${String(wall.getUTCMinutes()).padStart(2, '0')}`;
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "16 out" no horário de Brasília. */
export function formatLocalDay(date: Date): string {
  const wall = toWall(date);
  return `${String(wall.getUTCDate()).padStart(2, '0')} ${MONTHS[wall.getUTCMonth()]}`;
}

/** "16 out, 14:20" */
export function formatLocalDateTime(date: Date): string {
  return `${formatLocalDay(date)}, ${formatLocalTime(date)}`;
}

/** Mesmo dia de calendário em Brasília? */
export function isSameLocalDay(a: Date, b: Date): boolean {
  const wa = toWall(a);
  const wb = toWall(b);
  return (
    wa.getUTCFullYear() === wb.getUTCFullYear() && wa.getUTCMonth() === wb.getUTCMonth() && wa.getUTCDate() === wb.getUTCDate()
  );
}
