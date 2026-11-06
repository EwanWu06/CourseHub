import { useEffect, useState } from 'react';
import { reducedMotion } from './motion.ts';

/** Keeps an overlay on screen for its way out: after `open` turns false it stays mounted, `closing`, for `ms`. */
export function usePresence(open: boolean, ms = 180): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (reducedMotion()) {
      setMounted(false);
      return;
    }
    const id = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(id);
  }, [open, ms]);
  return { mounted: open || mounted, closing: !open && mounted };
}
