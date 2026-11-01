export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly requestId: string | undefined;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error?.message ?? 'The request could not be completed.');
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error?.code;
    this.requestId = body.error?.requestId;
  }
}

interface ApiResponse<T> {
  data: T;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (response.status === 204) return undefined as T;
  const body = (await response.json()) as ApiResponse<T> & ApiErrorBody;
  if (!response.ok) throw new ApiError(response.status, body);
  return body.data;
}

export async function getCsrfToken(): Promise<string> {
  return (await request<{ token: string }>('/auth/csrf')).token;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown, csrfToken: string) =>
    request<T>(path, {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(body),
    }),
  patch: <T>(path: string, body: unknown, csrfToken: string) =>
    request<T>(path, {
      method: 'PATCH',
      headers: { 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(body),
    }),
  postEmpty: (path: string, csrfToken: string) =>
    request<void>(path, {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken },
    }),
};
