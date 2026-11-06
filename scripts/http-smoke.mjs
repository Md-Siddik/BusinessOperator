/** Local HTTP checks. Uses only nonexistent synthetic credentials; never logs cookies/passwords. */
import { readFile, writeFile } from 'node:fs/promises';
const running = JSON.parse((await readFile('.data/runtime-process.json', 'utf8')).replace(/^\uFEFF/, ''));
const base = running.url;
const results = [];
async function check(path, expected, body) {
  const response = await fetch(new URL(path, base), {
    method: body ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(20000),
    headers: body ? { 'content-type': 'application/json', origin: base } : {},
    ...(body && { body: JSON.stringify(body) }),
  });
  const value = { path, status: response.status, expected, ok: response.status === expected };
  results.push(value);
  if (!value.ok) throw new Error('Unexpected HTTP status');
  if (path === '/api/auth/status' && (await response.json()).signedIn !== false) throw new Error('Unexpected anonymous status');
}
try {
  await check('/', 200);
  await check('/login', 200);
  await check('/api/auth/status', 200);
  await check('/api/auth/me', 401);
  await check('/api/auth/login', 401, { email: 'migration-probe@example.invalid', password: 'synthetic-invalid-login-probe' });
  await check('/api/daily-records/deletion', 401, {});
  const report = { at: new Date().toISOString(), url: base, checks: results, realPasswordLoginVerified: false, passwordVerificationBypassed: false };
  await writeFile('storage/backups/migration/http-smoke.json', JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
} catch { console.error(JSON.stringify({ localHttpChecksPassed: false, checks: results })); process.exitCode = 1; }
