import { useSyncExternalStore } from 'react';

/** Acompanha uma media query (ex.: `(max-width: 1280px)`) e re-renderiza quando ela muda. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Breakpoints do console: painel de chamados vira gaveta; lista e conversa viram telas. */
export const COMPACT_QUERY = '(max-width: 1280px)';
export const PHONE_QUERY = '(max-width: 760px)';
