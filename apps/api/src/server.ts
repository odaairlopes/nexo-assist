import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { explainListenError } from '@nexo/shared';
import { buildApp } from './app.ts';
import { config, withKey } from './config.ts';
import { seedDemoConversations } from './persistence/demo-conversations.ts';

const staticDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

// Banco vazio → conversas de exemplo para o console (como no protótipo).
const seeded = seedDemoConversations(config.dbPath);
if (seeded > 0) console.log(`[api] base vazia: ${seeded} conversas de exemplo criadas`);
const { app, store } = await buildApp({ config, staticDir: config.isProduction ? staticDir : undefined });

const shutdown = async () => {
  await app.close();
  store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host }).catch((err: unknown) => explainListenError(err, 'api', config.port, 'API_PORT'));
app.log.info(
  `Nexo Assist API em http://${config.host}:${config.port} · modelo ${config.llm.model}` +
    (config.llm.fallbackModel ? ` · reserva ${config.llm.fallbackModel}` : ' · sem reserva'),
);
if (!config.llm.baseUrl && !withKey(config.llm.model)) {
  app.log.warn(
    `Sem chave para ${config.llm.model}. O agent vai responder com a mensagem de contingência até você preencher a chave no .env ` +
      '(chave grátis do Groq: https://console.groq.com/keys).',
  );
}
