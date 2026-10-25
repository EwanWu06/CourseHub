import { useEffect, useRef, useState } from 'react';
import { reducedMotion as reduced } from '../lib/motion.ts';

// numbers count up on the first page of a visit only; once it is left, they show at once wherever they appear
let counted = false;

/** A number that counts up once when it first appears; later changes (polling) show at once, as does reduced motion. */
export function CountUp({ value, ms = 650 }: { value: number; ms?: number }) {
  const [shown, setShown] = useState(() => (counted || value <= 1 || reduced() ? value : 0));
  const done = useRef(counted);
  useEffect(() => () => void (counted = true), []);
  useEffect(() => {
    if (done.current || value <= 1 || reduced()) {
      done.current = true;
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setShown(Math.round(value * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(step);
      else done.current = true;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{shown}</>;
}
