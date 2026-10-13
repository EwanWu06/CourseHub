// Launches the user's real Google Chrome *normally* (no automation flags, so SSO pages such as Google or
// Microsoft don't treat it as a bot) with a dedicated profile, then observes it over the DevTools port.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext } from 'playwright-core';
import { chromeBin, paths } from '../config.ts';

export interface ChromeSession {
  browser: Browser;
  context: BrowserContext;
  userAgent: string;
  close(): Promise<void>;
  exited: Promise<number | null>;
}

let lock: Promise<unknown> = Promise.resolve();

/** Only one Chrome may use the shared profile at a time (and the Mac has 8GB of RAM). */
export function withChromeLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => undefined);
  return run;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function launchChrome(opts: { url: string; headless: boolean; profileDir?: string; userAgent?: string }): Promise<ChromeSession> {
  const profileDir = opts.profileDir ?? paths().profile;
  mkdirSync(profileDir, { recursive: true });
  const port = await freePort();
  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=ChromeWhatsNewUI,Translate',
    '--window-size=1100,860',
    ...(opts.headless ? ['--headless=new'] : []),
    ...(opts.userAgent ? [`--user-agent=${opts.userAgent}`] : []),
    opts.url,
  ];
  const proc = spawn(chromeBin(), args, { stdio: 'ignore' });
  const exited = new Promise<number | null>((resolve) => {
    proc.once('exit', (code) => resolve(code));
    proc.once('error', () => resolve(-1));
  });
  let processGone = false;
  void exited.then(() => {
    processGone = true;
  });

  let version: { 'User-Agent': string } | null = null;
  for (let i = 0; i < 75 && !version && !processGone; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) version = (await res.json()) as { 'User-Agent': string };
    } catch {
      await sleep(200);
    }
  }
  if (!version) {
    proc.kill('SIGKILL');
    throw new Error(processGone ? 'Chrome 启动后立即退出（可能已有同一配置的 Chrome 在运行）' : 'Chrome 启动超时');
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const userAgent = (opts.userAgent ?? version['User-Agent']).replace('HeadlessChrome', 'Chrome');

  async function close(): Promise<void> {
    if (!processGone) {
      try {
        const cdp = await browser.newBrowserCDPSession();
        await cdp.send('Browser.close');
      } catch {
        // already closing
      }
      const graceful = await Promise.race([exited.then(() => true), sleep(5000).then(() => false)]);
      if (!graceful) {
        proc.kill('SIGTERM');
        const termed = await Promise.race([exited.then(() => true), sleep(3000).then(() => false)]);
        if (!termed) proc.kill('SIGKILL');
      }
    }
    await browser.close().catch(() => undefined);
  }

  return { browser, context, userAgent, close, exited };
}
