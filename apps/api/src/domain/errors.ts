/** Erros de domínio com código estável — o handler HTTP traduz para status. */
export type DomainErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'conversation_closed'
  | 'message_limit_reached'
  | 'invalid_state'
  | 'helpdesk_unavailable';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  not_found: 404,
  forbidden: 403,
  conversation_closed: 409,
  message_limit_reached: 409,
  invalid_state: 409,
  helpdesk_unavailable: 503,
};
