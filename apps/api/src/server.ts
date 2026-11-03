import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { config } from './config.ts';

const staticDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const { app, store } = await buildApp({ config, staticDir: config.isProduction ? staticDir : undefined });

const shutdown = async () => {
  await app.close();
  store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
app.log.info(`Nexo Assist API em http://${config.host}:${config.port} · modelo ${config.llm.model}`);
