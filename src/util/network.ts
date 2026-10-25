// After the Mac wakes up, Wi-Fi can take a few seconds; jobs wait for the schools' hosts to resolve first.
import { lookup as dnsLookup } from 'node:dns/promises';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * True as soon as any school's host resolves, false once `timeoutMs` has passed. A lookup that hangs (the Mac half
 * asleep, Wi-Fi still coming up) is waited on, never started again on top: each stuck lookup holds one of libuv's
 * four worker threads, and a keep-alive once spent 15 minutes in this 90-second wait.
 */
export async function waitForNetwork(
  hosts: string[],
  opts: { lookup?: (host: string) => Promise<unknown>; timeoutMs?: number; stepMs?: number } = {},
): Promise<boolean> {
  if (hosts.length === 0) return true;
  const lookup = opts.lookup ?? ((h: string) => dnsLookup(h));
  const step = opts.stepMs ?? 3000;
  const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
  const inFlight = new Map<string, Promise<boolean>>();
  const attempt = (host: string) => {
    let p = inFlight.get(host);
    if (!p) {
      p = Promise.resolve().then(() => lookup(host)).then(() => true, () => false);
      inFlight.set(host, p);
      void p.then(() => inFlight.delete(host));
    }
    return p;
  };
  for (;;) {
    const any = Promise.any(hosts.map((h) => attempt(h).then((ok) => (ok ? true : Promise.reject(new Error(h)))))).catch(() => false);
    const answer = await Promise.race([any, sleep(step).then(() => null)]);
    if (answer === true) return true;
    if (Date.now() >= deadline) return false;
    if (answer === false) await sleep(step); // every host said "not found": ask again in a moment
  }
}
