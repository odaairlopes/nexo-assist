import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { initials, type Tone } from '@nexo/shared';
import s from './ui.module.css';

export function NexoMark({ size = 20, light = false }: { size?: number; light?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill={light ? '#ffffff' : '#037AF6'} />
      <path
        d="M6.5 17V7l11 10V7"
        fill="none"
        stroke={light ? '#1B2431' : '#ffffff'}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Dot({ tone, size = 6 }: { tone: Tone; size?: number }) {
  return <span className={s.dot} data-tone={tone} style={{ width: size, height: size }} aria-hidden="true" />;
}

const AVATAR_COLORS = [
  ['#DCE9F7', '#0062C4'],
  ['#F6E3D3', '#9A4A12'],
  ['#E6E1F7', '#5B3FC4'],
  ['#DDF0E6', '#1E7A4C'],
  ['#F7E1E6', '#A3324F'],
  ['#E5E8EC', '#3D4656'],
  ['#FBEFD0', '#8A6100'],
] as const;

function colorFor(seed: string): readonly [string, string] {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

export function Avatar({ name, size = 34, online, ringColor }: { name: string; size?: number; online?: boolean; ringColor?: string }) {
  const [bg, fg] = colorFor(name);
  return (
    <span className={s.avatar} style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.34 }} aria-hidden="true">
      {initials(name)}
      {online && <span className={s.online} style={{ borderColor: ringColor ?? 'var(--paper)' }} />}
    </span>
  );
}

export function Spinner({ size = 12 }: { size?: number }) {
  return <span className={s.spinner} style={{ width: size, height: size }} role="status" aria-label="Carregando" />;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  icon,
  children,
  loading,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: ReactNode; loading?: boolean }) {
  return (
    <button {...rest} className={`${s.button} ${className ?? ''}`} data-variant={variant} disabled={rest.disabled || loading}>
      {loading ? <Spinner size={14} /> : icon}
      {children}
    </button>
  );
}

export function Pill({ tone, children, icon }: { tone: 'success' | 'warning' | 'primary' | 'danger'; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={s.pill} data-tone={tone}>
      {icon ?? <Dot tone={tone} size={7} />}
      {children}
    </span>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className={s.error} role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className={s.linkButton}>
          Tentar de novo
        </button>
      )}
    </div>
  );
}
