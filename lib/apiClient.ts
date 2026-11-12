/**
 * Browser-side GET helper for the app/api/** route handlers. Same-origin
 * only (the session cookie is httpOnly); never cached.
 */
export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`Request failed with status ${status}`);
    this.name = "ApiError";
  }
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    signal,
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new ApiError(response.status);
  return (await response.json()) as T;
}

export const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;
export const isNotFound = (error: unknown) => error instanceof ApiError && error.status === 404;
