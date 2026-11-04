import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { initials, type Tone } from '@nexo/shared';
import s from './ui.module.css';

/**
 * Símbolo da Nexo (arquivo oficial nexo_logo.svg). O SVG original tem
 * viewBox de 20×20, mas o desenho vai até x≈26 e ficava cortado; aqui o
 * enquadramento é o do próprio desenho (24,4 × 20,6), centralizado.
 */
const NEXO_MARK_PATH =
  'M21.763 .245l-3.374 1.687c-.623 .308-.973 .903-.973 1.631v6.293l-11.193-9.429c-.623-.469-1.372-.553-2.03-.245l-3.185 1.631c-.651 .322-1.008 .924-1.008 1.673v15.218c0 1.477 1.526 2.289 2.716 1.785l3.073-1.617c.693-.322 1.057-.952 1.057-1.722v-7.7l11.732 10.591c.602 .546 1.421 .679 2.086 .364l2.786-1.505c.602-.315 .938-.931 .938-1.68v-15.288c0-1.463-1.505-2.275-2.625-1.687z';

export function NexoMark({ size = 20, light = false }: { size?: number; light?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 -1.9 24.4 24.4" aria-hidden="true" focusable="false">
      <path d={NEXO_MARK_PATH} fill={light ? '#FFFFFF' : '#037AF6'} />
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

/** Cores fixas do protótipo para as pessoas que aparecem nele. */
const DESIGN_COLORS: Record<string, readonly [string, string]> = {
  'Ana Souza': ['#DCE9F7', '#0062C4'],
  'Carla Mendes': ['#F6E3D3', '#9A4A12'],
  'Bruno Tavares': ['#E6E1F7', '#5B3FC4'],
  'Diego Ramos': ['#DDF0E6', '#1E7A4C'],
  'Elisa Prado': ['#F7E1E6', '#A3324F'],
  'Fábio Nunes': ['#E5E8EC', '#3D4656'],
  'Gabriela Rocha': ['#FBEFD0', '#8A6100'],
};

function colorFor(seed: string): readonly [string, string] {
  const fixed = DESIGN_COLORS[seed];
  if (fixed) return fixed;
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

/**
 * Avatar com iniciais. `tone="self"` usa o azul do "você" do protótipo (RL no
 * console, AS na barra lateral). A bolinha verde só aparece com `online`.
 */
export function Avatar({
  name,
  size = 34,
  online,
  ringColor,
  tone,
}: {
  name: string;
  size?: number;
  online?: boolean;
  ringColor?: string;
  tone?: 'self';
}) {
  const [bg, fg] = tone === 'self' ? (['var(--primary-soft)', 'var(--primary-text)'] as const) : colorFor(name);
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
