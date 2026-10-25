/** The reader asked the system for less motion: skip animations and the waits that exist only to show them. */
export const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
