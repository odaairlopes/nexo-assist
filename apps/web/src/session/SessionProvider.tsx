import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LoginRequest, SessionUser } from '@nexo/shared';
import { setUnauthorizedHandler } from '../api/client.ts';
import { authApi } from '../api/endpoints.ts';

interface SessionValue {
  user: SessionUser | null;
  loading: boolean;
  login: (req: LoginRequest) => Promise<SessionUser>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    authApi
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (req: LoginRequest) => {
    const { user: u } = await authApi.login(req);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession fora do SessionProvider');
  return ctx;
}
