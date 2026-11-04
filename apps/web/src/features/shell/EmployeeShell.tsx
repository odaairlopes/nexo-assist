import type { ReactNode } from 'react';
import { ChevronRight, LogOut, MessageSquare, UserRound } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Avatar, NexoMark } from '../../components/ui.tsx';
import { useSession } from '../../session/SessionProvider.tsx';
import s from './EmployeeShell.module.css';

export function EmployeeShell({ title, status, children }: { title: string; status?: ReactNode; children: ReactNode }) {
  const { user, logout } = useSession();
  const navigate = useNavigate();

  return (
    <div className={s.shell}>
      <aside className={s.sidebar}>
        <div className={s.logo}>
          <NexoMark size={20} />
          <span>Nexo Assist</span>
        </div>
        <nav className={s.nav} aria-label="Principal">
          <NavLink to="/" end className={({ isActive }) => (isActive ? `${s.navItem} ${s.active}` : s.navItem)}>
            <MessageSquare size={16} aria-hidden="true" />
            Atendimento
          </NavLink>
          <NavLink to="/perfil" className={({ isActive }) => (isActive ? `${s.navItem} ${s.active}` : s.navItem)}>
            <UserRound size={16} aria-hidden="true" />
            Meu perfil
          </NavLink>
        </nav>
        <div className={s.spacer} />
        {user && (
          <div className={s.user}>
            <Avatar name={user.name} size={34} tone="self" />
            <div className={s.userText}>
              <strong>{user.name}</strong>
              <span>{user.email}</span>
            </div>
          </div>
        )}
        <button
          type="button"
          className={s.navItem}
          onClick={async () => {
            await logout();
            navigate('/login', { replace: true });
          }}
        >
          <LogOut size={16} aria-hidden="true" />
          Sair
        </button>
      </aside>

      <main className={s.main}>
        <header className={s.topBar}>
          <div className={s.breadcrumb}>
            <span>Service desk de TI</span>
            <ChevronRight size={14} aria-hidden="true" />
            <strong>{title}</strong>
          </div>
          {status}
        </header>
        <div className={s.content}>{children}</div>
      </main>
    </div>
  );
}
