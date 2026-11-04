import { useCallback, useEffect, useRef, type RefObject } from 'react';

/** Distância do fim (px) até onde ainda consideramos que a pessoa "está no fim". */
const NEAR_BOTTOM_PX = 120;

/**
 * "Gruda no fim" de uma área rolável, como em apps de chat.
 *
 * Observa o tamanho do conteúdo (ResizeObserver): sempre que ele cresce —
 * mensagem nova, card, indicador de "digitando", fonte carregando — rola até
 * o fim, mas SÓ se a pessoa já estava perto do fim. Se ela subiu para reler o
 * histórico, não é puxada de volta. `scrollToBottom()` força (ex.: ao enviar).
 */
export function useStickToBottom<T extends HTMLElement>(scrollRef: RefObject<T | null>, contentRef: RefObject<HTMLElement | null>) {
  const stuck = useRef(true);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stuck.current = true;
    // Salto direto (sem animação): rolagem suave "chega" antes do conteúdo crescer.
    el.scrollTo({ top: el.scrollHeight, behavior: 'instant' as ScrollBehavior });
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;

    const onScroll = () => {
      stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    };
    const observer = new ResizeObserver(() => {
      if (stuck.current) el.scrollTo({ top: el.scrollHeight, behavior: 'instant' as ScrollBehavior });
    });

    el.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(content);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [scrollRef, contentRef]);

  /**
   * Acompanha o fim de forma síncrona (chamado logo após renderizar conteúdo
   * novo). Rede de segurança para quando o navegador não está pintando
   * quadros — aba em segundo plano — e o ResizeObserver fica parado.
   */
  const follow = useCallback(() => {
    const el = scrollRef.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [scrollRef]);

  return { scrollToBottom, follow };
}
