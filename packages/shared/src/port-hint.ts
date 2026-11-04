/**
 * Mensagem clara quando a porta já está em uso — o caso mais comum é um
 * servidor de uma execução anterior que ficou rodando em segundo plano.
 */
export function explainListenError(err: unknown, service: string, port: number, envVar: string): never {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'EADDRINUSE') {
    console.error(
      `\n[${service}] A porta ${port} já está em uso — provavelmente um servidor de uma execução anterior ainda está rodando.\n` +
        `  • Windows: feche os processos "Node.js" no Gerenciador de Tarefas (ou rode: taskkill /F /IM node.exe)\n` +
        `  • macOS/Linux: lsof -ti :${port} | xargs kill\n` +
        `  • Ou use outra porta: defina ${envVar} no .env\n`,
    );
  } else {
    console.error(`[${service}] falha ao iniciar:`, err);
  }
  process.exit(1);
}
