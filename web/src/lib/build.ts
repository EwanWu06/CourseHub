/// <reference lib="dom" />
// Which web build this page is: the hashed entry script Vite writes into index.html (null on the dev server).
export function buildFromScriptSrc(src: string | null | undefined): string | null {
  const m = src?.match(/\/assets\/(index-[A-Za-z0-9_-]+)\.js(?:\?|$)/);
  return m ? m[1] : null;
}

export function currentBuild(): string | null {
  if (typeof document === 'undefined') return null;
  return buildFromScriptSrc(document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src);
}
