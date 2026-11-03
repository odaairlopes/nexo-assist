import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ServerEvent } from '@nexo/shared';

/**
 * Server-Sent Events: unidirecional, nativo no browser (EventSource), passa
 * por proxies HTTP comuns e reconecta sozinho. Para este caso (servidor
 * empurrando eventos; cliente envia por POST) é mais simples que WebSocket.
 */
export function openSse(
  req: FastifyRequest,
  reply: FastifyReply,
  subscribe: (send: (event: ServerEvent) => void) => () => void,
): void {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 2000\n\n');

  const send = (event: ServerEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const unsubscribe = subscribe(send);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);

  req.raw.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
