import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { EllipsisVertical } from 'lucide-react';
import s from './Console.module.css';

export interface MenuAction {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  tone?: 'danger';
  disabled?: boolean;
}

/**
 * Menu "⋮" do cabeçalho da conversa. Padrão de menu acessível: Enter/Espaço
 * abre, setas navegam, Esc fecha e devolve o foco; clique fora também fecha.
 */
export function HeaderMenu({ actions, label = 'Mais opções' }: { actions: MenuAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const items = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    items()[0]?.focus();

    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const list = items();
      const i = list.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[next]?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={s.menuWrap}>
      <button
        ref={buttonRef}
        type="button"
        className={s.iconButton}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <EllipsisVertical size={18} />
      </button>
      {open && (
        <div ref={menuRef} id={menuId} role="menu" aria-label={label} className={s.menu}>
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              className={s.menuItem}
              data-tone={a.tone}
              disabled={a.disabled}
              onClick={() => {
                setOpen(false);
                a.onSelect();
              }}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
