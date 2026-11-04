import { describe, expect, it } from 'vitest';
import { partialReply } from './turn-runner.ts';

describe('partialReply (streaming da resposta)', () => {
  it('lê o reply de um JSON incompleto', () => {
    expect(partialReply('{"understood":"x","reply":"Está aguard')).toBe('Está aguard');
  });

  it('decodifica escapes e ignora escape cortado no fim', () => {
    expect(partialReply('{"reply":"Linha 1\\nLinha \\"2\\"')).toBe('Linha 1\nLinha "2"');
    expect(partialReply('{"reply":"abc\\')).toBe('abc');
    expect(partialReply('{"reply":"caf\\u00')).toBe('caf');
  });

  it('retorna null antes de o campo aparecer', () => {
    expect(partialReply('{"understood":"x"')).toBeNull();
  });
});
