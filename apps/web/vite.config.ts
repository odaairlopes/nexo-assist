import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em dev, o Vite faz proxy de /api para a API: mesmo origin, então o cookie
// de sessão HttpOnly funciona sem CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.API_PORT ?? 4000}`,
        changeOrigin: false,
        // Nos primeiros segundos do `npm run dev` o front sobe antes da API. Em vez
        // do stack trace do Vite, responde 503 em silêncio — o front reconecta sozinho.
        configure: (proxy) => {
          const emit = proxy.emit.bind(proxy) as (event: string, ...args: unknown[]) => boolean;
          proxy.emit = ((event: string, ...args: unknown[]) => {
            const [err, , res] = args as [NodeJS.ErrnoException, unknown, { headersSent?: boolean; writeHead?: (s: number) => { end: () => void } }];
            if (event === 'error' && err?.code === 'ECONNREFUSED' && res?.writeHead) {
              if (!res.headersSent) res.writeHead(503).end();
              return true;
            }
            return emit(event, ...args);
          }) as typeof proxy.emit;
        },
      },
    },
  },
});
