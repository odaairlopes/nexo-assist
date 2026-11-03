export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Callback global para sessão expirada (o SessionProvider redireciona ao login). */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'network', 'Sem conexão com o servidor. Verifique sua rede.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/login')) onUnauthorized?.();
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'Algo deu errado. Tente de novo.');
  }
  return data as T;
}
