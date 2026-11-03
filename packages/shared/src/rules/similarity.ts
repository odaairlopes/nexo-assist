import type { Category } from '../domain.ts';

const STOPWORDS = new Set(
  'a o as os de do da dos das e é em no na nos nas um uma uns umas para pra por com sem que se meu minha meus minhas seu sua ao à não nao mais muito está esta estou tem ter foi ser como quando desde ontem hoje agora já ja só so me eu ele ela isso este essa esse aqui lá vou vai preciso precisa problema erro'.split(
    ' ',
  ),
);

/** Normaliza: minúsculas, sem acento, só letras/números. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Radical bem simples (corta plurais e sufixos verbais comuns em PT). */
function stem(token: string): string {
  if (token.length <= 4) return token;
  return token.replace(/(mente|coes|cao|ando|endo|indo|ados|idas|ado|ido|ada|ida|ar|er|ir|es|s)$/, '');
}

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

export interface SimilarityTarget {
  title: string;
  description: string;
  category: Category;
}

/**
 * Similaridade entre dois chamados, de 0 a 1: Jaccard sobre os termos de
 * título+descrição, com bônus quando a categoria coincide.
 *
 * Trade-off: embeddings seriam mais robustos a sinônimos, mas exigem outra
 * chamada de modelo por verificação. Como o universo comparado é pequeno (os
 * chamados de *um* funcionário), lexical + categoria resolve bem e custa zero.
 * O LLM ainda participa: ele vê os chamados abertos e decide se é o mesmo
 * problema; este score é a trava determinística por baixo.
 */
export function ticketSimilarity(a: SimilarityTarget, b: SimilarityTarget): number {
  const ta = new Set(tokenize(`${a.title} ${a.title} ${a.description}`));
  const tb = new Set(tokenize(`${b.title} ${b.title} ${b.description}`));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const jaccard = inter / (ta.size + tb.size - inter);
  // Normaliza pelo menor conjunto também: textos curtos x longos.
  const overlap = inter / Math.min(ta.size, tb.size);
  const lexical = 0.5 * jaccard + 0.5 * overlap;
  const categoryBonus = a.category === b.category ? 0.25 : 0;
  return Math.min(1, Number((lexical * 0.75 + categoryBonus).toFixed(3)));
}

/** Acima disso, criar um chamado novo é bloqueado: deve-se atualizar o existente. */
export const DUPLICATE_BLOCK_THRESHOLD = 0.55;
/** Acima disso, o agent é avisado de um possível duplicado. */
export const DUPLICATE_WARN_THRESHOLD = 0.35;
