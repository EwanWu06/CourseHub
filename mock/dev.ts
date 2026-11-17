// Two fake schools for manual QA: alpha on :4301 (with an external SSO page), beta on :4302.
// Log in with student / password.
import { startMockCanvas } from './server.ts';

const alpha = await startMockCanvas({ variant: 'alpha', port: 4301, idp: true });
const beta = await startMockCanvas({ variant: 'beta', port: 4302 });
console.log(`alpha (SSO): ${alpha.baseUrl}   beta: ${beta.baseUrl}   login: student / password`);

const stop = async () => {
  await Promise.all([alpha.close(), beta.close()]);
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
