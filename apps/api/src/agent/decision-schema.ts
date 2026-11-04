import { z } from 'zod';
import { ActionSchema, IntentSchema } from '@nexo/shared';

/**
 * Saída estruturada de cada turno. Além da resposta, o modelo PRECISA declarar
 * o que entendeu, qual ação tomou, com que confiança e por quê — é a base da
 * transparência (cada mensagem guarda isso no trace) e das travas do código
 * (ex.: confiança baixa vira transferência).
 *
 * Campos planos e obrigatórios (com null/[]) funcionam melhor com structured
 * output estrito dos provedores do que uniões discriminadas.
 */
export const DecisionSchema = z.object({
  understood: z.string().describe('O que o funcionário quer, em uma frase, na terceira pessoa.'),
  intent: IntentSchema,
  action: ActionSchema,
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Sua segurança de que a ação está certa: 0.9+ certeza; 0.6–0.8 razoável; abaixo de 0.5 você não deveria decidir sozinho.'),
  reasoning: z.string().describe('Por que esta ação, citando a regra do service desk ou o artigo usado. 1–3 frases.'),
  reply: z.string().describe('Mensagem para o funcionário: curta, clara, em português, sem jargão. Não repita dados que já aparecem nos cards.'),
  // Campos de UI opcionais: provedores com validação estrita (ex.: Groq) rejeitam a
  // chamada inteira se um campo "obrigatório" faltar — o código normaliza a ausência.
  question: z.string().nullish().describe('Pergunta destacada para completar informação (ex.: "Quem está sendo afetado?") ou null.'),
  options: z
    .array(z.string())
    .max(4)
    .nullish().describe('Respostas rápidas clicáveis (até 4). [] se não houver.'),
  show_ticket_id: z.string().nullish().describe('ID de UM chamado para exibir como card (ex.: ao mostrar status). null se não houver.'),
  show_ticket_selector: z
    .array(z.string())
    .nullish()
    .describe('IDs para o funcionário escolher quando há mais de um chamado possível. [] se não houver.'),
  show_draft_id: z.string().nullish().describe('draft_id do rascunho a exibir para confirmação. null se não houver.'),
});

export type Decision = z.infer<typeof DecisionSchema>;
