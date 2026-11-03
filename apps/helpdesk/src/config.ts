import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === '' ? fallback : Number(raw);
  if (Number.isNaN(n)) throw new Error(`Variável ${name} inválida: ${raw}`);
  return n;
}

const serviceToken = process.env.HELPDESK_SERVICE_TOKEN;
if (!serviceToken) {
  throw new Error('HELPDESK_SERVICE_TOKEN não definido. Copie .env.example para .env.');
}

export const config = {
  port: num('HELPDESK_PORT', 4001),
  host: process.env.HELPDESK_HOST ?? '127.0.0.1',
  serviceToken,
  dbPath: process.env.HELPDESK_DB_PATH ?? path.join(root, 'data', 'helpdesk.db'),
  /** Probabilidade (0..1) de responder 503, simulando o legado instável. */
  failureRate: num('HELPDESK_FAILURE_RATE', 0.1),
  /** Latência artificial máxima, em ms. */
  maxLatencyMs: num('HELPDESK_MAX_LATENCY_MS', 250),
} as const;
