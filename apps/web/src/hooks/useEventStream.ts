import { useEffect, useRef, useState } from 'react';
import type { ServerEvent } from '@nexo/shared';

export type StreamStatus = 'connecting' | 'open' | 'reconnecting';

/**
 * Assina um endpoint SSE. O EventSource reconecta sozinho; ao reabrir,
 * `onReconnect` permite recarregar o estado (eventos perdidos na queda).
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
    let opened = false;
    const source = new EventSource(url, { withCredentials: true });
    source.onopen = () => {
      setStatus('open');
      if (opened) reconnect.current?.();
      opened = true;
    };
    source.onerror = () => setStatus('reconnecting');
    source.onmessage = (e: MessageEvent<string>) => {
      try {
        handler.current(JSON.parse(e.data) as ServerEvent);
      } catch {
        /* evento malformado: ignora */
      }
    };
    return () => source.close();
  }, [url]);

  return status;
}
