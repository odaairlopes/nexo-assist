import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LoginRequest, SessionUser } from '@nexo/shared';
import { setUnauthorizedHandler } from '../api/client.ts';
import { authApi } from '../api/endpoints.ts';

interface SessionValue {
  user: SessionUser | null;
  loading: boolean;
  login: (req: LoginRequest) => Promise<SessionUser>;
  logout: () => Promise<void>;
  /** Confere no servidor quem está logado (o cookie vale para o navegador inteiro). */
  revalidate: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Troca o usuário só se mudou de fato (evita re-renderizar a árvore à toa).
  const applyUser = useCallback((next: SessionUser | null) => {
    setUser((current) => (current?.email === next?.email && current?.role === next?.role ? current : next));
  }, []);

  const revalidate = useCallback(async () => {
    try {
      applyUser((await authApi.me()).user);
    } catch {
      applyUser(null);
    }
  }, [applyUser]);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    void revalidate().finally(() => setLoading(false));
  }, [revalidate]);

  // Login trocado em outra aba: ao voltar para esta, ela passa a mostrar a pessoa certa.
  useEffect(() => {
    const onFocus = () => void revalidate();
    const onVisible = () => document.visibilityState === 'visible' && onFocus();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [revalidate]);

  const login = useCallback(async (req: LoginRequest) => {
    const { user: u } = await authApi.login(req);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, revalidate }), [user, loading, login, logout, revalidate]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession fora do SessionProvider');
  return ctx;
}
