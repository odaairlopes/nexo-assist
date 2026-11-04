import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, LogOut, Menu, MessageSquare, UserRound, X } from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, NexoMark } from '../../components/ui.tsx';
import { useSession } from '../../session/SessionProvider.tsx';
import s from './EmployeeShell.module.css';

/**
 * Casca do colaborador. No desktop, barra lateral fixa; no celular (≤ 860 px)
 * a mesma barra vira uma gaveta, aberta pelo botão de menu do topo.
 */
export function EmployeeShell({ title, status, children }: { title: string; status?: ReactNode; children: ReactNode }) {
  const { user, logout } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Trocar de página fecha a gaveta.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  // Gaveta aberta: foco vai para dentro, Esc fecha e devolve o foco ao botão.
  useEffect(() => {
    if (!menuOpen) return;
    drawerRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? `${s.navItem} ${s.active}` : s.navItem);

  return (
    <div className={s.shell}>
      <div className={s.backdrop} data-open={menuOpen} onClick={() => setMenuOpen(false)} aria-hidden="true" />
      <aside className={s.sidebar} data-open={menuOpen} ref={drawerRef} id="menu-principal" aria-label="Menu">
        <div className={s.logo}>
          <NexoMark size={20} />
          <span>Nexo Assist</span>
          <button type="button" className={s.closeMenu} onClick={() => setMenuOpen(false)} aria-label="Fechar menu">
            <X size={18} />
          </button>
        </div>
        <nav className={s.nav} aria-label="Principal">
          <NavLink to="/" end className={navClass}>
            <MessageSquare size={16} aria-hidden="true" />
            Atendimento
          </NavLink>
          <NavLink to="/perfil" className={navClass}>
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
          <button
            type="button"
            ref={menuButtonRef}
            className={s.menuButton}
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menu"
            aria-expanded={menuOpen}
            aria-controls="menu-principal"
          >
            <Menu size={20} />
          </button>
          <div className={s.breadcrumb}>
            <span className={s.crumbRoot}>Service desk de TI</span>
            <ChevronRight size={14} aria-hidden="true" className={s.crumbRoot} />
            <span className={s.mobileMark}>
              <NexoMark size={18} />
            </span>
            <strong>{title}</strong>
          </div>
          {status && <div className={s.status}>{status}</div>}
        </header>
        <div className={s.content}>{children}</div>
      </main>
    </div>
  );
}
