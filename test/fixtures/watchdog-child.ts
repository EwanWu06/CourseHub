// A stand-in server process for the watchdog tests: start the watchdog, then behave as told.
import { startWatchdog } from '../../src/watchdog.ts';
const [mode, note] = process.argv.slice(2);
startWatchdog({ hangMs: 1500, checkMs: 200, notePath: note });
process.send?.('ready');
if (mode === 'hang') {
  setTimeout(() => {
    const end = Date.now() + 20_000;
    while (Date.now() < end) { /* a stuck main thread */ }
  }, 300);
} else {
  setTimeout(() => process.exit(0), mode === 'sleepy' ? 6000 : 2500);
}
