type JsonRequestInit = RequestInit & {
  headers?: HeadersInit;
};

export async function getJson<T>(url: string): Promise<T> {
  return requestJson<T>(url, { cache: "no-store" });
}

export async function requestJson<T>(
  url: string,
  init?: JsonRequestInit,
): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(await responseError(res));
  }
  return (await res.json()) as T;
}

export async function requestOk(
  url: string,
  init?: JsonRequestInit,
): Promise<void> {
  const res = await fetch(url, init);
  if (!res.ok && res.status !== 204) {
    throw new Error(await responseError(res));
  }
}

export function jsonHeaders(
  headers?: HeadersInit,
): HeadersInit {
  return { ...headers, "content-type": "application/json" };
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

async function responseError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as
    | { error?: unknown }
    | null;
  return typeof data?.error === "string" ? data.error : `HTTP ${res.status}`;
}
