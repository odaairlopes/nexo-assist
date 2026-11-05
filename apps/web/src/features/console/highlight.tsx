import type { ReactNode } from 'react';
import { normalize } from './filters.ts';

/**
 * Normaliza caractere a caractere (sem acento, minúsculo), mantendo um
 * caractere normalizado por caractere original, para que os índices batam.
 */
function foldChars(text: string): { chars: string[]; folded: string } {
  const chars = [...text];
  const folded = chars.map((ch) => normalize(ch).charAt(0) || ch).join('');
  return { chars, folded };
}

/** A busca acha o texto? (ignora maiúsculas e acentos) */
export function containsQuery(text: string, query: string): boolean {
  const q = normalize(query.trim());
  return q.length > 0 && foldChars(text).folded.includes(q);
}

/** Destaca as ocorrências da busca com <mark>, ignorando maiúsculas e acentos. */
export function highlight(text: string, query: string, className?: string): ReactNode {
  const q = normalize(query.trim());
  if (!q) return text;
  const { chars, folded } = foldChars(text);
  const parts: ReactNode[] = [];
  let from = 0;
  let at = folded.indexOf(q);
  while (at !== -1) {
    if (at > from) parts.push(chars.slice(from, at).join(''));
    parts.push(
      <mark key={at} className={className}>
        {chars.slice(at, at + q.length).join('')}
      </mark>,
    );
    from = at + q.length;
    at = folded.indexOf(q, from);
  }
  if (parts.length === 0) return text;
  if (from < chars.length) parts.push(chars.slice(from).join(''));
  return parts;
}
