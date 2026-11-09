/// <reference lib="dom" />
import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Connection = 'up' | 'down';
let connection: Connection = 'up';
const listeners = new Set<(c: Connection) => void>();

function setConnection(c: Connection): void {
  if (c === connection) return;
  connection = c;
  for (const l of listeners) l(c);
}

/** Whether the last request reached the Course Hub server (it restarts after updates and on the watchdog). */
export function getConnection(): Connection {
  return connection;
}

export function onConnection(fn: (c: Connection) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  // every request ends: a hung server shows as an error instead of an endless spinner (AI work runs in the background)
  const timeoutMs = init.timeoutMs ?? (method === 'GET' ? 30_000 : 120_000);
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { 'X-CourseHub': '1', ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    setConnection('down');
    if ((err as Error).name === 'TimeoutError') throw new ApiError(0, `Course Hub 后台没有响应（等了 ${Math.max(1, Math.round(timeoutMs / 1000))} 秒）`);
    throw new ApiError(0, '连不上 Course Hub 后台（可能正在重启），会自动重试');
  }
  setConnection('up');
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? res.statusText);
  return data as T;
}

/** Fire this after any change so every mounted view refetches. */
export function refreshAll(): void {
  window.dispatchEvent(new Event('coursehub:refresh'));
}

export function useApi<T>(path: string | null, opts: { poll?: number } = {}) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const seen = useRef<string | null>(null);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    if (seen.current !== path) {
      seen.current = path;
      setLoading(true);
    }
    api<T>(path)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, tick]);

  useEffect(() => {
    const onRefresh = () => reload();
    window.addEventListener('coursehub:refresh', onRefresh);
    const id = opts.poll ? setInterval(reload, opts.poll) : undefined;
    return () => {
      window.removeEventListener('coursehub:refresh', onRefresh);
      if (id) clearInterval(id);
    };
  }, [opts.poll, reload]);

  return { data, error, loading, reload, setData };
}
