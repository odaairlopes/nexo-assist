import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} não definido. Copie .env.example para .env e preencha.`);
  return v;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === '' ? fallback : Number(raw);
  if (Number.isNaN(n)) throw new Error(`Variável ${name} inválida: ${raw}`);
  return n;
}

/** Variável de chave de cada provedor do model router. */
const KEY_VARS: Record<string, string[]> = {
  google: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'],
  groq: ['GROQ_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
};

/** O modelo tem chave configurada? (Provedores desconhecidos/locais passam.) */
export function withKey(model: string | undefined): boolean {
  if (!model) return false;
  const vars = KEY_VARS[model.split('/')[0] ?? ''];
  return !vars || vars.some((v) => Boolean(process.env[v]));
}

const jwtSecret = required('JWT_SECRET');
if (jwtSecret.length < 32) throw new Error('JWT_SECRET precisa ter ao menos 32 caracteres');

export const config = {
  port: num('API_PORT', 4000),
  host: process.env.API_HOST ?? '127.0.0.1',
  isProduction: process.env.NODE_ENV === 'production',
  dbPath: process.env.API_DB_PATH ?? path.join(root, 'data', 'api.db'),
  jwtSecret,
  helpdesk: {
    baseUrl: process.env.HELPDESK_URL ?? 'http://127.0.0.1:4001',
    serviceToken: required('HELPDESK_SERVICE_TOKEN'),
    timeoutMs: num('HELPDESK_TIMEOUT_MS', 2500),
    retries: num('HELPDESK_RETRIES', 3),
  },
  llm: {
    /**
     * Modelo no formato do model router do Mastra: "provedor/modelo".
     * Padrão gratuito: Gemini 2.5 Flash (cota free do Google AI Studio).
     */
    model: process.env.LLM_MODEL || 'google/gemini-2.5-flash',
    /**
     * Reserva automática quando o principal falha ou estoura a cota
     * (ex.: groq/openai/gpt-oss-120b, também gratuito). Vazio = sem reserva.
     */
    fallbackModel: withKey(process.env.LLM_FALLBACK_MODEL) ? process.env.LLM_FALLBACK_MODEL! : null,
    /** Endpoint compatível com OpenAI (Ollama, LM Studio, vLLM…). Opcional. */
    baseUrl: process.env.LLM_BASE_URL || null,
    apiKey: process.env.LLM_API_KEY || null,
    maxSteps: num('LLM_MAX_STEPS', 6),
    /** Quantas mensagens recentes vão para o modelo a cada turno. */
    historyWindow: num('LLM_HISTORY_WINDOW', 14),
  },
  agent: {
    /** Abaixo disso, o agent não decide sozinho: transfere para um analista. */
    minConfidence: num('AGENT_MIN_CONFIDENCE', 0.5),
  },
  rateLimit: {
    /** Mensagens por minuto por usuário — protege custo de LLM no deploy. */
    messagesPerMinute: num('RATE_LIMIT_MESSAGES_PER_MINUTE', 12),
  },
} as const;

export type AppConfig = typeof config;
