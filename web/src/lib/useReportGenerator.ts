import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api.ts';

/** Starts a report and waits for it (also picks up one the scheduler is already making). */
export function useReportGenerator(type: 'daily' | 'weekly', onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  const alive = useRef(true);

  const wait = useCallback(async () => {
    setBusy(true);
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      if (!alive.current) return;
      const s = await api<{ running: string[] }>('/api/reports/status').catch(() => ({ running: [] as string[] }));
      if (!s.running.includes(type)) break;
    }
    setBusy(false);
    done.current();
  }, [type]);

  useEffect(() => {
    alive.current = true;
    void api<{ running: string[] }>('/api/reports/status').then((s) => { if (s.running.includes(type)) void wait(); }).catch(() => undefined);
    return () => { alive.current = false; };
  }, [type, wait]);

  const start = useCallback(async () => {
    setError(null);
    try {
      await api(`/api/reports/${type}/generate`, { method: 'POST' });
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) {
        setError((e as Error).message);
        return;
      }
    }
    await wait();
  }, [type, wait]);

  return { start, busy, error };
}
