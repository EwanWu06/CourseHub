// Screenshots pages with the installed Chrome (headless) for visual QA.
//   node scripts/screenshot.ts <baseUrl> <outDir> <path> [path...] [--dark] [--mobile]
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { chromeBin } from '../src/config.ts';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [base, outDir, ...pages] = args.filter((a) => !a.startsWith('--'));
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: chromeBin(), headless: true });
const viewport = flags.has('--mobile') ? { width: 390, height: 844 } : { width: 1280, height: 860 };
const context = await browser.newContext({ viewport, colorScheme: flags.has('--dark') ? 'dark' : 'light', deviceScaleFactor: flags.has('--mobile') ? 2 : 1 });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
for (const p of pages) {
  await page.goto(base + p, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const name = `${p.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'}-${flags.has('--dark') ? 'dark' : 'light'}-${viewport.width}.png`;
  await page.screenshot({ path: path.join(outDir, name), fullPage: true });
  console.log('saved', name);
}
if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
await browser.close();
