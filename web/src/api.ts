import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: { 'X-CourseHub': '1', ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
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
