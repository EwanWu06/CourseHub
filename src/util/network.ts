// After the Mac wakes up, Wi-Fi can take a few seconds; jobs wait for the schools' hosts to resolve first.
import { lookup as dnsLookup } from 'node:dns/promises';

export async function waitForNetwork(
  hosts: string[],
  opts: { lookup?: (host: string) => Promise<unknown>; timeoutMs?: number; stepMs?: number } = {},
): Promise<boolean> {
  if (hosts.length === 0) return true;
  const lookup = opts.lookup ?? ((h: string) => dnsLookup(h));
  const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
  for (;;) {
    try {
      await lookup(hosts[0]);
      return true;
    } catch {
      if (Date.now() >= deadline) return false;
      await new Promise((r) => setTimeout(r, opts.stepMs ?? 3000));
    }
  }
}
