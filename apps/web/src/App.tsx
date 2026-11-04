import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { SessionUser } from '@nexo/shared';
import { Spinner } from './components/ui.tsx';
import { LoginPage } from './features/auth/LoginPage.tsx';
import { ChatPage } from './features/chat/ChatPage.tsx';
import { ConsolePage } from './features/console/ConsolePage.tsx';
import { ProfilePage } from './features/profile/ProfilePage.tsx';
import { useSession } from './session/SessionProvider.tsx';

const home = (role: SessionUser['role']) => (role === 'analyst' ? '/console' : '/');

/** Rota protegida por perfil: funcionário não abre o console e vice-versa. */
function Guard({ role, children }: { role: SessionUser['role']; children: ReactNode }) {
  const { user, loading } = useSession();
  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <Spinner size={20} />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={home(user.role)} replace />;
  return <>{children}</>;
}

export function App() {
  const { user, loading } = useSession();
  return (
    <Routes>
      <Route path="/login" element={!loading && user ? <Navigate to={home(user.role)} replace /> : <LoginPage />} />
      <Route
        path="/"
        element={
          <Guard role="employee">
            <ChatPage key={user?.email} />
          </Guard>
        }
      />
      <Route
        path="/perfil"
        element={
          <Guard role="employee">
            <ProfilePage />
          </Guard>
        }
      />
      <Route
        path="/console"
        element={
          <Guard role="analyst">
            <ConsolePage key={user?.email} />
          </Guard>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
