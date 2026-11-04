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

interface ApiResponse<T, Meta = unknown> {
  data: T;
  meta?: Meta;
}

async function requestEnvelope<T, Meta = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<ApiResponse<T, Meta>> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (response.status === 204) return { data: undefined as T };
  const body = (await response.json()) as ApiResponse<T, Meta> & ApiErrorBody;
  if (!response.ok) throw new ApiError(response.status, body);
  return body;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await requestEnvelope<T>(path, init)).data;
}

export async function getCsrfToken(): Promise<string> {
  return (await request<{ token: string }>('/auth/csrf')).token;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  getPage: async <T, Meta>(path: string): Promise<{ data: T; meta: Meta }> => {
    const response = await requestEnvelope<T, Meta>(path);
    if (response.meta === undefined) {
      throw new Error('The server did not return pagination metadata.');
    }
    return { data: response.data, meta: response.meta };
  },
  post: <T>(
    path: string,
    body: unknown,
    csrfToken: string,
    additionalHeaders: Record<string, string> = {},
  ) =>
    request<T>(path, {
      method: 'POST',
      headers: { ...additionalHeaders, 'X-CSRF-Token': csrfToken },
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
