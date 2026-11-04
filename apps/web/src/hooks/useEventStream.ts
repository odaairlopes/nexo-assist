import { useEffect, useRef, useState } from 'react';
import type { ServerEvent } from '@nexo/shared';

export type StreamStatus = 'connecting' | 'open' | 'reconnecting';

const MAX_BACKOFF_MS = 15_000;

/**
 * Assina um endpoint SSE e mantém a conexão viva.
 *
 * O EventSource só reconecta sozinho em queda de rede; se o servidor responder
 * com erro HTTP (ex.: 502 do proxy durante um deploy/reinício da API), ele
 * fecha para sempre. Por isso a reconexão é feita aqui, com backoff. A cada
 * reconexão, `onReconnect` recarrega o estado — eventos perdidos na queda
 * voltam pela carga completa.
 */
export function useEventStream(
  url: string | null,
  onEvent: (event: ServerEvent) => void,
  onReconnect?: () => void,
): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const handler = useRef(onEvent);
  const reconnect = useRef(onReconnect);
  handler.current = onEvent;
  reconnect.current = onReconnect;

  useEffect(() => {
    if (!url) return;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let everOpened = false;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      source = new EventSource(url, { withCredentials: true });
      source.onopen = () => {
        setStatus('open');
        if (everOpened || attempts > 0) reconnect.current?.();
        everOpened = true;
        attempts = 0;
      };
      source.onerror = () => {
        setStatus('reconnecting');
        // CLOSED = o navegador desistiu (erro HTTP): reconecta manualmente.
        if (source?.readyState === EventSource.CLOSED) {
          source.close();
          const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempts);
          attempts++;
          retryTimer = setTimeout(connect, delay);
        }
      };
      source.onmessage = (e: MessageEvent<string>) => {
        try {
          handler.current(JSON.parse(e.data) as ServerEvent);
        } catch {
          /* evento malformado: ignora */
        }
      };
    };

    // Só conecta depois do evento "load": uma conexão SSE aberta durante o
    // carregamento deixa o navegador com a aba eternamente "carregando".
    const onLoad = () => connect();
    if (document.readyState === 'complete') connect();
    else window.addEventListener('load', onLoad, { once: true });

    return () => {
      disposed = true;
      window.removeEventListener('load', onLoad);
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
  }, [url]);

  return status;
}
