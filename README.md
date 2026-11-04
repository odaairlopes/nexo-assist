# Nexo Assist

Agent de atendimento do service desk de TI da Nexo. O funcionário descreve o problema num chat e o agent decide, a cada mensagem, se **responde uma dúvida**, **consulta ou atualiza um chamado**, **abre um chamado novo** (com rascunho para confirmação) ou **chama um analista**. Do outro lado, o analista tem um console para ver as conversas que precisam dele, assumir o atendimento com o agent pausado e devolver ou encerrar.

- **Funcionário:** login → chat com respostas em tempo real, cards de chamado, seletor, rascunho com Confirmar/Editar/Cancelar, respostas rápidas e limite de 30 mensagens por sessão.
- **Analista:** console com filtros (Para você / Com o agent / Minhas), busca, resumo da transferência, assumir/devolver/encerrar e painel com os chamados do funcionário.
- **Transparência:** acima de cada resposta aparecem as ações do agent ("consultou seus chamados", "classificou a prioridade") em tempo real. O botão **Por quê?** abre o detalhe da decisão: o que o agent entendeu, a intenção, a ação, a confiança, o motivo, cada ferramenta chamada (com entrada e saída) e as regras que o sistema aplicou por cima do modelo.

---

## Requisitos do PRD → onde estão

### Requisitos técnicos

| Tema | Requisito | Como foi atendido |
| --- | --- | --- |
| Linguagem | TypeScript com tipagem estrita | `strict`, `noUncheckedIndexedAccess`, zero `any` explícito; contratos compartilhados em `packages/shared` |
| Agent | **Mastra** (preferência) ou LangGraph.js | **Mastra** (`@mastra/core`): `Agent` em `apps/api/src/agent/nexo-agent.ts`, `createTool` em `tools.ts`, `RequestContext` para a identidade do funcionário e instância `new Mastra({ agents })` em `apps/api/src/mastra/index.ts` |
| Modelo | Qualquer provedor; explicar a escolha | Groq gratuito: `gpt-oss-120b` + reserva `qwen3.8-27b` (ver [Modelo](#modelo-gratuito-rápido-e-com-reserva-automática)) |
| Interface | Seguir o protótipo (Next.js ou React) | React 18 + Vite; tokens, sombras e tipografia extraídos do arquivo do protótipo |
| Dados | Serviço de chamados simulado, separado do agent | `apps/helpdesk`: processo próprio, acessado só por HTTP com token de serviço |
| Persistência | Conversas, chamados e estado sobrevivem a reinício | SQLite em `./data` (API e helpdesk) |
| Execução | Poucos comandos + `.env.example` | `npm install` → `npm run dev` |

### O que construir

| # | Item | Onde |
| --- | --- | --- |
| 1 | Login (Tela 1) | `apps/web/src/features/auth` |
| 2 | Chat: tempo real, cards, seleção, rascunho, opções rápidas, limite de 30 | `apps/web/src/features/chat` (SSE em `apps/api/src/http/sse.ts`) |
| 3 | Agent decide seguindo o Anexo A | `apps/api/src/agent` + regras em `packages/shared/src/rules` |
| 4 | Serviço de chamados: consultar, criar, atualizar, transferir | `apps/helpdesk/src/app.ts` |
| 5 | Transferência: aguardando atendente, agent para | `ConversationService.transfer` / `postUserMessage` |
| 6 | Console: filtros, histórico, assumir, devolver, encerrar, chamados | `apps/web/src/features/console` |
| 7 | Visibilidade das decisões | Linha de ações + painel **Por quê?** (`components/decision`) |

### Anexo A (regras do service desk)

| Regra | Onde é garantida |
| --- | --- |
| Tipos INC/REQ e 6 categorias | Schemas em `packages/shared/src/domain.ts` |
| Chamado completo + rascunho antes de criar | `draft_new_ticket` (rascunho) → criação só em `ConversationService.executeDraft` após confirmação |
| Sem duplicidade; reabrir resolvidos há até 7 dias | `ticketSimilarity` bloqueia na tool; `canReopen` no helpdesk |
| Transferência (pedido, crítico, vencido, sem segurança) + resumo | `transfer_to_analyst`, travas em `guardrails.ts` (confiança < 50%, crítico → N2) |
| Privacidade | Identidade via `RequestContext`; helpdesk responde 404 para chamado de outra pessoa |
| Escopo só TI | Prompt + cenário `fora-do-escopo` no eval |
| Prioridade e prazos (horas úteis) | `classifyPriority` e `computeDueDate` (testados) |

### Entregáveis do README
Como rodar · Arquitetura · Como o agent decide · Como garanti a qualidade · Trade-offs · O que faria com mais tempo: seções abaixo. Deploy (diferencial opcional) não foi feito.

---

## Como rodar

Requisitos: **Node.js 22.13+** (usa o SQLite nativo do Node, então não precisa de Docker nem de banco) e uma chave **gratuita** do Groq, gerada em [console.groq.com/keys](https://console.groq.com/keys) sem cartão.

```bash
npm install
```

```bash
cp .env.example .env
```

Edite o `.env`:

- preencha `GROQ_API_KEY` (a mesma chave serve para o modelo principal e para a reserva);
- troque `JWT_SECRET` e `HELPDESK_SERVICE_TOKEN`.

```bash
npm run dev
```

Abra **http://localhost:5173**. Qualquer senha é aceita para as contas do seed:

| Conta | Perfil | Para testar |
| --- | --- | --- |
| `ana.souza@nexo.com.br` | Funcionária (Windows 11) | Sem conversa. Chamado vencido, resolvido há 4 dias, VPN erro 809 |
| `marcos.vieira@nexo.com.br` | Funcionário (Windows 11) | Sem conversa. Chat do zero |
| `diego.ramos@nexo.com.br` | Funcionário (Windows 10) | Conversa em andamento; não vê os chamados da Ana |
| `rafael.lima@nexo.com.br` | Analista N2 | Console do analista |
| `julia.costa@nexo.com.br` | Analista N1 | Console; está atendendo a Juliana |

Os dados de exemplo têm **14 funcionários** (11 funcionários e 3 analistas), **10 artigos** na central de ajuda, **22 chamados** em todas as situações (aberto, vencido, aguardando o funcionário, aprovado, crítico, resolvido há pouco e há muito tempo, encerrado) e **8 conversas** no console, nos estados do protótipo.

**Passo a passo para testar cada história do PRD: [docs/ROTEIRO_DE_TESTE.md](docs/ROTEIRO_DE_TESTE.md).**

Outros comandos:

| Comando              | O que faz                                              |
| -------------------- | ------------------------------------------------------ |
| `npm test`           | Testes unitários e de integração (Vitest, sem LLM)     |
| `npm run eval`       | Avaliação do agent com o modelo real (cenários do PRD) |
| `npm run typecheck`  | TypeScript estrito em todos os pacotes                 |
| `npm run seed:reset` | Apaga `./data`; o seed roda de novo no próximo start   |

O `npm run dev` sobe três processos: o **helpdesk** simulado (`:4001`), a **API** com o agent (`:4000`) e a **interface** (`:5173`, que faz proxy de `/api`). Se alguma porta estiver ocupada, defina `API_PORT`, `HELPDESK_PORT` + `HELPDESK_URL` e `WEB_PORT` no ambiente.

### Modelo: gratuito, rápido e com reserva automática

O projeto roda **sem custo**, com **uma única chave gratuita do Groq**:

| Papel     | Modelo                     | Por quê                                                                                        |
| --------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| Principal | `groq/openai/gpt-oss-120b` | Bom em _tool calling_ e responde em ~1–2 s, com raciocínio no mínimo (`reasoningEffort: low`). |
| Reserva   | `groq/qwen/qwen3.8-27b`    | Mesma chave, cota diária separada. Assume na hora se o principal falhar ou estourar a cota.    |

**Por que um modelo pequeno dá conta:** as regras pesadas (prioridade, prazo, duplicidade, privacidade) são código. O modelo só interpreta a mensagem e escolhe a ação.

**Como a decisão é obtida (e por que não "structured output"):** a decisão é uma ferramenta, `respond`, com o schema Zod da decisão (entendimento, intenção, ação, confiança, motivo, resposta, cards). O turno termina quando ela é chamada (`stopWhen`). Antes testei o _structured output_ do Mastra, mas misturado com tools ele falhava de formas diferentes em cada provedor: o Gemini exige o schema no prompt, e o Groq rejeitava a resposta com "tool choice required". _Tool calling_ é o recurso mais bem suportado entre provedores. Há duas redes de segurança:

- se o modelo escrever a decisão como texto, o código valida esse JSON pelo mesmo schema e o aproveita;
- se nem isso acontecer, uma chamada curta de reparo força a ferramenta.

**Robustez com cota gratuita (lições dos testes):**

- O plano gratuito do Groq limita **8 mil tokens por minuto** e **200 mil por dia** por modelo. Por isso, antes de chamar o modelo, o código já carrega os chamados do funcionário e os artigos relevantes no prompt. A maioria dos turnos sai com uma chamada ao LLM, em vez de 2–3.
- Com a cota esgotada, o roteador do Mastra espera ~30 s e tenta de novo. Um **watchdog** aborta a tentativa após 8 s sem dados e passa para a reserva. Isso só acontece se nenhuma ferramenta tiver sido executada, então nenhum efeito é repetido.
- Cada turno tem tempo máximo de 45 s. Depois disso entra a resposta de contingência, que oferece um analista.
- Não usei a lista de fallbacks nativa do Mastra (`model: [...]`): na versão usada, ela acrescentava ~40 s a toda chamada. A reserva é feita no `AgentTurnRunner`.

**Trade-off:** no plano gratuito, os limites mudam sem aviso e o provedor pode usar os dados. Isso é aceitável com dados fictícios. Em produção, basta trocar o `LLM_MODEL` para um plano pago (ex.: `openai/gpt-4.1-mini` + `OPENAI_API_KEY`). Gemini e modelos locais (Ollama, via `LLM_BASE_URL`) também funcionam, mas nos meus testes o Gemini gratuito ficou lento ou sobrecarregado, e modelos locais de 7–8B não chamaram tools de forma confiável.

---

## Arquitetura

```
apps/
  web/        React 18 + Vite: login, chat, console, perfil
  api/        Fastify: auth, conversas, SSE, console + agent (Mastra)
  helpdesk/   Fastify: simulador do sistema de chamados legado + central de ajuda
packages/
  shared/     Tipos, contratos (Zod) e REGRAS DO SERVICE DESK (puras, testadas)
```

```
 Browser ──HTTP/SSE──▶ API ─────────────────────────────▶ Helpdesk (legado)
                        │  ConversationService             tickets, KB, funcionários
                        │   (estado, rascunhos,            token de serviço, 503s
                        │    transferência)                 simulados, idempotência
                        │        ▲
                        │  AgentTurnRunner ──▶ Mastra Agent ──▶ LLM
                        │        │               └─ tools ──▶ HelpdeskClient
                        │  finalizeTurn (travas determinísticas)
                        └─ SQLite: conversas, mensagens + trace, rascunhos
```

**Separação de responsabilidades**

- **Interface (`apps/web`)** só exibe estado e envia intenções do usuário (mensagem, confirmar, assumir…). Não tem regra de negócio.
- **Domínio (`ConversationService`)** é a máquina de estados da conversa (`agent → waiting_human → human → agent | closed`) e o **único** lugar que cria ou altera chamado, sempre a partir de um rascunho confirmado.
- **Agent (`apps/api/src/agent`)** interpreta a mensagem e escolhe a ação. As tools leem dados e montam rascunhos, mas não têm efeito colateral sem confirmação.
- **Serviço de chamados (`apps/helpdesk`)** é um processo separado, acessado só por HTTP, como um ServiceNow ou GLPI de verdade. A privacidade também é aplicada lá: um chamado de outra pessoa responde 404.
- **Regras (`packages/shared/rules`)** são funções puras: matriz de prioridade, prazos em horas úteis, janela de reabertura e similaridade para duplicidade. O mesmo código roda no back e no front.

**Decisões principais**

| Decisão                                         | Por quê                                                                                                                 | Trade-off                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| SQLite nativo do Node (`node:sqlite`)           | Persistência real (sobrevive a reinício) com zero infraestrutura para o avaliador                                       | Uma instância só. Em produção: Postgres                                 |
| SSE em vez de WebSocket                         | O servidor só empurra eventos; o cliente envia por POST. É nativo no browser, reconecta sozinho e passa por proxies     | Sem canal bidirecional (aqui não precisa)                               |
| Event bus em memória                            | Simples e suficiente para um processo                                                                                   | Com várias instâncias, trocar por Redis Pub/Sub (a interface é a mesma) |
| Sessão em JWT num cookie HttpOnly + SameSite    | O front nunca toca no token; protege contra XSS roubando sessão                                                         | Login aceita qualquer senha (pedido do PRD); o real seria SSO/OIDC      |
| Monorepo com tipos compartilhados               | Front e back quebram juntos na compilação quando um contrato muda                                                       | —                                                                       |
| Persistência própria em vez da Memory do Mastra | Conversa, estado (agent/analista) e trace precisam ser consultáveis pelo console e sobreviver a reinício no mesmo banco | O histórico enviado ao modelo é montado manualmente (`history.ts`)      |

---

## Como o agent decide o que fazer

Cada mensagem do funcionário vira um **turno**:

1. **Pode responder?** Se a conversa está com um analista ou aguardando um, o agent **não é chamado**. A trava fica no código (`ConversationService.postUserMessage`), não no prompt. Turnos da mesma conversa rodam em fila, nunca em paralelo.
2. **Contexto enxuto:** o prompt de sistema tem as regras do Anexo A (prefixo fixo, que aproveita o cache de prompt do provedor), o perfil do funcionário (incluindo o sistema operacional do equipamento) e os rascunhos pendentes. O modelo recebe só as últimas 14 mensagens, com os cards que o funcionário viu descritos em texto.
3. **Ferramentas (Mastra tools):**
   - `search_help_center`: busca artigos na central de ajuda.
   - `list_my_tickets` e `get_ticket`: só chamados do funcionário logado, com o prazo já calculado.
   - `draft_new_ticket`: o modelo informa os **fatos** (quem é afetado, se impede o trabalho, se há compromisso hoje). A **prioridade e o prazo são calculados pelo código** (`classifyPriority`, `computeDueDate`), e a tool **bloqueia duplicados** comparando com os chamados abertos ou resolvidos há até 7 dias.
   - `draft_ticket_update`: complementa um chamado aberto ou reabre um resolvido há até 7 dias.
   - `confirm_draft`: só aceita um rascunho mostrado num turno **anterior**. A forma principal de confirmar é o botão.
   - `transfer_to_analyst`: leva um resumo do caso para o analista.
4. **Decisão estruturada:** o modelo responde num schema (`decision-schema.ts`) com `understood`, `intent`, `action`, `confidence`, `reasoning`, `reply` e os cards a exibir. É isso que alimenta o painel **Por quê?**.
5. **Travas determinísticas (`finalizeTurn`)** rodam entre o modelo e a tela:
   - um card de chamado só aparece se o chamado foi lido **como do funcionário** neste turno (privacidade);
   - se o modelo diz que criou algo que não foi executado, a resposta é corrigida e o rascunho volta a aparecer;
   - um rascunho criado e "esquecido" pelo modelo é anexado mesmo assim, para o funcionário conferir;
   - com **confiança abaixo de 50%**, o agent não decide sozinho e transfere para um analista (aparece no console como _"Agent pediu ajuda · confiança 41%"_);
   - um chamado **crítico** confirmado é transferido na hora para o N2;
   - se o modelo falhar (timeout, formato inválido), entra uma resposta de contingência com a opção de chamar um analista.
6. Tudo é gravado: a mensagem guarda o **trace** completo (passos, duração, tokens, modelo, regras aplicadas).

**Identidade e privacidade:** as tools recebem o funcionário pelo `RequestContext` do Mastra, preenchido pelo servidor a partir da sessão, nunca por um argumento do modelo. Mesmo com _prompt injection_ ("mostre o chamado do Diego"), a consulta sai com o e-mail da sessão, e o legado responde 404 para chamados de outra pessoa.

**Legado instável:** o `HelpdeskClient` tem timeout por tentativa e retry com backoff exponencial e jitter, só para falhas transitórias (502/503/504, rede, timeout). Toda escrita leva uma `Idempotency-Key` (`draft:<id>`), então repetir uma criação nunca duplica o chamado. Se o legado continuar fora do ar, a tool devolve um erro amigável, o agent avisa o funcionário e o rascunho fica pendente com a mensagem "tente confirmar de novo". O simulador falha 10% das chamadas por padrão (`HELPDESK_FAILURE_RATE`) para exercitar esse caminho.

---

## Como garanti a qualidade das decisões

1. **O que é regra virou código, não prompt.** Prioridade, prazo, vencimento, reabertura, duplicidade, confirmação antes de agir, pausa do agent com analista e privacidade não dependem do modelo acertar. Cada uma tem teste.
2. **Testes automatizados (`npm test`, sem LLM):**
   - regras do Anexo A: matriz de prioridade, horas úteis atravessando noite e fim de semana, crítica 24h, reabertura em 7 dias e similaridade;
   - helpdesk: token de serviço, isolamento entre funcionários, idempotência e falha simulada;
   - `ConversationService`, contra o helpdesk real em memória: o agent não roda com analista, o ciclo assumir → devolver, o limite de 30 mensagens, a confirmação idempotente e o crítico transferindo;
   - `finalizeTurn`: card de outra pessoa omitido, confiança baixa transferindo, modelo "mentindo" e sendo corrigido, e a contingência.
3. **Avaliação com o modelo real (`npm run eval`):** 11 cenários tirados das histórias do PRD (dúvida, status sem número, chamado vencido, pergunta antes de abrir, rascunho com prioridade correta, duplicidade, reabertura, privacidade, fora do escopo, pedido de analista, caso crítico). As checagens olham a **decisão** (ferramentas usadas, cards, estado da conversa), não o texto exato. Assim, dá para trocar de modelo ou de prompt e comparar o resultado. Resultados durante o desenvolvimento: 61% → 89% com `gpt-oss-120b` à medida que corrigi o formato da decisão, e 96% (27/28) com `qwen3.8-27b`. Entre cenários há uma pausa de 20 s (`EVAL_PAUSE_MS`) para respeitar o limite por minuto do plano gratuito.
4. **Transparência como ferramenta de depuração:** o mesmo painel **Por quê?** aparece para o analista no console. Ele vê por que o agent transferiu e com que confiança.

---

## Eficiência e custo

- Um modelo pequeno e rápido, porque o trabalho pesado é determinístico.
- O histórico vai com uma janela de 14 mensagens. O estado importante (rascunhos pendentes) volta pelo prompt de sistema.
- As tools devolvem resumos compactos, não o payload inteiro do legado.
- O prefixo do prompt é fixo, o que aproveita o cache de prompt dos provedores.
- A busca na central de ajuda é lexical e local: custa zero e é instantânea com dezenas de artigos.
- Para controlar abuso e custo: rate limit por usuário nas mensagens (12/min), limite de 30 mensagens por sessão, `maxSteps` por turno e tamanho máximo das mensagens.
- O trace de cada resposta registra tokens de entrada e saída e a latência, o que permite medir o custo por conversa.

## Segurança

- Chaves só no `.env` (fora do git). Há um `.env.example` sem segredos.
- Cookie de sessão `HttpOnly`, `SameSite=Lax` e `Secure` em produção. JWT curto (8h, ou 30 dias com "manter conectado").
- As rotas checam o perfil: o funcionário não abre o console e o analista não usa o chat.
- O funcionário só acessa as próprias conversas e chamados. Recursos de outra pessoa respondem como "não encontrado", sem confirmar que existem.
- O token entre serviços é comparado em tempo constante.
- Toda entrada é validada com Zod. Há headers de segurança básicos e rate limit no login.

---

## Principais trade-offs

- **Sem LLM, sem agent:** não há um modo de regras para quando o provedor cai. A resposta de contingência oferece o analista. Um fallback por palavras-chave seria possível, mas pioraria a qualidade das decisões.
- **Busca lexical na central de ajuda:** é suficiente para 10 artigos. Com uma base real, eu usaria embeddings e busca híbrida.
- **Duplicidade por similaridade lexical + categoria:** é barata e explicável (o score aparece no trace), mas sinônimos fortes escapam. O modelo também vê os chamados abertos e costuma pegar esses casos.
- **Horário útil sem feriados**, em fuso fixo de Brasília (o Brasil não tem horário de verão desde 2019).
- **Uma instância**, com bus em memória e SQLite. A troca para Redis e Postgres não muda a interface das camadas.

## O que faria com mais tempo

- Rodar o eval na CI a cada mudança de prompt ou modelo, com LLM-as-judge para o tom das respostas, e acompanhar a taxa de acerto por cenário.
- Observabilidade: OpenTelemetry nos turnos (o Mastra já emite spans), dashboards de custo, latência e taxa de transferência, e Sentry no front e no back.
- Busca semântica na central de ajuda e sugestão de artigo novo a partir de chamados repetidos.
- Calendário de feriados, fila e capacidade por nível (N1/N2) e notificação ao analista.
- SSO corporativo (OIDC), Postgres, Redis Pub/Sub e deploy com várias instâncias.
- Testes E2E com Playwright nos fluxos principais.
- Resumo automático de conversas longas para manter o contexto além da janela.

---

## Estrutura de pastas

```
apps/api/src
  mastra/       instância Mastra com os agents registrados (principal e reserva)
  agent/        nexo-agent, tools, instruções, schema da decisão, travas, executor do turno
  clients/      HelpdeskClient (timeout, retry, idempotência)
  domain/       ConversationService (estado, rascunhos, transferência), erros
  eval/         cenários e runner da avaliação com LLM
  http/         auth (cookie/JWT), rotas, SSE
  persistence/  Store (SQLite)
  realtime/     EventBus
apps/helpdesk/src  app, repositório, seed (funcionários, 10 artigos, chamados)
apps/web/src       features/{auth,chat,console,profile,shell}, components, hooks
packages/shared/src  domain, contracts, labels, rules/
```
