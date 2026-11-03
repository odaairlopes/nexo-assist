import { buildApp } from './app.ts';
import { config } from './config.ts';
import { openDatabase } from './db.ts';
import { HelpdeskRepository } from './repository.ts';
import { seed } from './seed.ts';

const db = openDatabase(config.dbPath);
const repo = new HelpdeskRepository(db);

if (repo.isEmpty()) {
  seed(repo);
  console.log('[helpdesk] base vazia: dados de exemplo criados');
}

const app = buildApp({
  repo,
  serviceToken: config.serviceToken,
  failureRate: config.failureRate,
  maxLatencyMs: config.maxLatencyMs,
  logger: true,
});

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
console.log(`[helpdesk] legado simulado em http://${config.host}:${config.port} (falha ${Math.round(config.failureRate * 100)}%)`);
