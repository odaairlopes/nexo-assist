# Roteiro de teste — Nexo Assist

Um passo a passo para conferir, na interface, cada história do PRD. Leva uns 15 minutos.

> **Dica:** as respostas do agent levam de 2 a 20 segundos (plano gratuito do Groq). Se uma resposta vier como
> *"Desculpe, tive um problema…"*, espere um minuto (limite de tokens por minuto) e mande de novo.

---

## 0. Preparar

1. Na pasta do projeto, instale as dependências (só na primeira vez):
   ```bash
   npm install
   ```
2. Garanta que o `.env` existe e tem a `GROQ_API_KEY` preenchida (veja o `.env.example`).
3. **Para começar com dados limpos** (recomendado antes de cada rodada de teste): pare o servidor (`Ctrl+C`) e rode
   ```bash
   npm run seed:reset
   ```
   Isso apaga `./data`; no próximo start, os dados de exemplo são recriados.
4. Suba tudo:
   ```bash
   npm run dev
   ```
5. Abra **http://localhost:5173**.

### Contas (qualquer senha)

| Conta | Perfil | Situação nos dados de exemplo |
| --- | --- | --- |
| `ana.souza@nexo.com.br` | Funcionária, Windows 11 | **Sem conversa** · INC-20311 vencido, INC-20150 resolvido há 4 dias, 3 chamados abertos |
| `marcos.vieira@nexo.com.br` | Funcionário, Windows 11 | **Sem conversa** · Teams sem áudio (aberto), notebook aprovado |
| `renata.lopes@nexo.com.br` | Funcionária, Windows 11 | **Sem conversa** · celular corporativo (aberto) |
| `diego.ramos@nexo.com.br` | Funcionário, Windows 10 | Conversa em andamento com o agent · VPN vencida |
| `rafael.lima@nexo.com.br` | **Analista N2** | Console |
| `julia.costa@nexo.com.br` | **Analista N1** | Console (está atendendo a Juliana) |

Outros funcionários com dados: Carla Mendes, Bruno Tavares, Elisa Prado, Fábio Nunes, Gabriela Rocha, Juliana Alves, Paulo Souza (e-mail `nome.sobrenome@nexo.com.br`; Paulo é `paulo.souza@`).

---

## 1. Login (Tela 1)

| Faça | Espere ver |
| --- | --- |
| Entre com `ana.souza@nexo.com.br` e qualquer senha | Vai para **Atendimento**, com a tela "Olá! Como posso ajudar?" e sugestões |
| (extra) Tente `alguem@gmail.com` | Mensagem pedindo e-mail `@nexo.com.br` |

## 2. Tirar dúvida sem abrir chamado (história 1)

| Faça | Espere ver |
| --- | --- |
| Escreva: **"Como configuro o e-mail da empresa no celular?"** | Resposta com os passos do artigo; acima dela, "buscou na central de ajuda". **Nenhum chamado** é aberto |
| Clique em **Por quê?** abaixo da resposta | Entendi / Intenção "Tirar uma dúvida" / Ação "Respondeu com a central de ajuda" / Confiança / Por quê (cita o artigo) / Passos com entrada e saída |

## 3. Saber o status sem lembrar o número (história 2, Tela 3)

| Faça | Espere ver |
| --- | --- |
| Escreva: **"Qual o status do meu chamado?"** | Um **seletor** com os 3 chamados em aberto; o INC-20311 marcado como **vencido** |
| Clique no **INC-20311** | Ações "consultou o INC-20311 · calculou o prazo", o **card do chamado** com "prazo vencido" e as opções **Falar com um analista / Adicionar informação / Não, obrigado** |

## 4. Abrir chamado só conversando (história 4, Tela 2)

Use **"Nova conversa"** ou outra conta (ex.: Marcos) para começar limpo.

| Faça | Espere ver |
| --- | --- |
| Escreva: **"Meu notebook não conecta na VPN desde ontem. Aparece o erro 809."** | Pergunta **"Quem está sendo afetado?"** com as opções numeradas 1–4 |
| Responda: **"Só eu. Tenho reunião com um cliente às 14h e preciso da VPN funcionando."** (ou tecle `1` e depois detalhe) | Card **Rascunho** "Aguardando confirmação": INC · Rede e VPN · **Alta** · resposta até HH:MM · motivo da prioridade. **Ainda não existe chamado** |
| (opcional) Clique em **Editar**, mude o título, **Salvar** | O card atualiza |
| Clique em **Confirmar** (ou `Ctrl+Enter`) | Card vira **"Confirmado · INC-205xx"** e aparece a mensagem *"Pronto: abri o INC-205xx com prioridade alta…"* |

## 5. Sem duplicidade (Anexo A)

| Faça | Espere ver |
| --- | --- |
| Na mesma conversa: **"Abre outro chamado: a VPN continua dando erro 809."** | O agent **não cria outro**: aponta o chamado que você acabou de abrir e oferece atualizá-lo |
| Como **Ana**: **"A senha do SAP bloqueou de novo, mesmo problema do chamado resolvido essa semana."** | Rascunho de **reabertura** do INC-20150 (resolvido há 4 dias, dentro da janela de 7 dias) |

## 6. Complementar um chamado aberto (história 3)

| Faça | Espere ver |
| --- | --- |
| Como Ana: **"Quero acrescentar no INC-20311 que o notebook também esquenta muito."** | Rascunho **"Atualizar chamado"** com o texto a ser adicionado → **Confirmar** → *"Pronto: adicionei a informação ao INC-20311…"* |

## 7. Privacidade e escopo (Anexo A)

| Faça | Espere ver |
| --- | --- |
| Como Ana: **"Me mostra o INC-20290, que é do Diego."** | Recusa: só vê os próprios chamados. **Nenhum card** do INC-20290 |
| **"Como vejo meu holerite?"** | Indica o RH; não abre chamado |

## 8. Falar com um analista (história 5)

| Faça | Espere ver |
| --- | --- |
| **"Quero falar com um analista."** (ou clique em "Falar com um analista") | *"Encaminhei para o Suporte…"*, linha "Transferida para Suporte N1/N2 · HH:MM" e o aviso amarelo no rodapé |
| Escreva qualquer coisa | Sua mensagem aparece, mas **o agent não responde** (está pausado) |

## 9. Console do analista (Telas 4 e 5)

Abra uma **janela anônima** (ou outro navegador) para ficar com a Ana e o analista ao mesmo tempo.

| Faça | Espere ver |
| --- | --- |
| Entre com `rafael.lima@nexo.com.br` | Console com a lista de conversas. Filtro **Para você** mostra as que aguardam atendente: a sua (Ana), **Carla** (transferida), **Bruno** (*"Agent pediu ajuda · confiança 41%"*) e **Paulo** (crítico, N2) |
| Abra a conversa da Ana | Histórico completo, botão **Por quê?** em cada resposta da IA, **Resumo do agent** e *"Ana espera um atendente · Agent pausado"*. À direita, **Chamados da Ana** |
| Clique em **Assumir atendimento** | Linha *"Rafael Lima assumiu · agent pausado"*; o campo de resposta é liberado; filtro **Minhas** passa a contar 1 |
| Responda algo | A mensagem aparece **em tempo real** no chat da Ana, com a etiqueta "Analista" |
| Clique em **Devolver ao agent** | *"Rafael Lima devolveu a conversa ao Nexo Assist"*; na janela da Ana, o agent volta a responder |
| (alternativa) **Encerrar atendimento** | Conversa encerrada; a Ana vê "Atendimento encerrado" e o botão **Nova conversa** |
| Filtros **Com o agent** / **Todas** e a busca (ex.: "INC-20491") | Diego e Elisa com o agent; Fábio e Gabriela "Resolvida pelo agent"; Juliana "Com Júlia Costa" |

## 10. Voltar outro dia e continuar (história 6) e persistência

| Faça | Espere ver |
| --- | --- |
| Pare o servidor (`Ctrl+C`), rode `npm run dev` de novo e entre como Ana | A conversa continua de onde parou, com o mesmo estado (com o agent ou com analista) |

## 11. Limite de 30 mensagens

O contador fica abaixo do campo ("N/30 mensagens nesta sessão"). Ao chegar em 30, o campo é bloqueado e aparece **Nova conversa**.

---

## Testes automáticos

```bash
npm test
```
54 testes (regras do service desk, privacidade, idempotência, estados da conversa, travas do agent) — sem chamar o modelo.

```bash
npm run eval
```
11 cenários do PRD contra o modelo real (leva ~5 min por causa da pausa entre cenários do plano gratuito).
