// One short message at the foot of the screen ("已完成「HW 6」 · 撤销"); a newer one replaces it.
import { useSyncExternalStore } from 'react';

export interface Toast { id: number; text: string; action?: { label: string; run: () => void }; closing?: boolean }

let current: Toast | null = null;
let timer = 0;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showToast(t: { text: string; action?: Toast['action'] }, ms = 5000): void {
  clearTimeout(timer);
  current = { ...t, id: ++seq };
  emit();
  timer = window.setTimeout(dismissToast, ms);
}

/** Plays the way out (180ms), then clears. */
export function dismissToast(): void {
  clearTimeout(timer);
  if (!current || current.closing) return;
  const id = current.id;
  current = { ...current, closing: true };
  emit();
  timer = window.setTimeout(() => {
    if (current?.id !== id) return;
    current = null;
    emit();
  }, 180);
}

export function useToast(): Toast | null {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, () => current);
}
