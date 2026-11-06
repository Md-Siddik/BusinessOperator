/** Private verification: never pass a password as an argument or environment variable. */
import nextEnv from '@next/env';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import { isIP } from 'node:net';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { emitKeypressEvents } from 'node:readline';
import { stdin, stdout } from 'node:process';

nextEnv.loadEnvConfig(process.cwd());
if (process.env.MONGODB_DNS_SERVERS?.trim()) {
  const servers = process.env.MONGODB_DNS_SERVERS.split(',').map(value => value.trim());
  if (!servers.length || servers.length > 3 || servers.some(value => !isIP(value))) throw new Error('Invalid MONGODB_DNS_SERVERS configuration.');
  dns.setServers(servers);
  dnsPromises.setServers(servers);
}

async function privatePassword() {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Run this command in your own interactive terminal.');
  stdout.write('Original password (hidden; never logged): ');
  emitKeypressEvents(stdin);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let password = '';
    function finish() {
      stdin.off('keypress', onKey);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write('\n');
    }
    function onKey(text, key = {}) {
      if (key.ctrl && key.name === 'c') { password = ''; finish(); reject(new Error('Cancelled.')); }
      else if (key.name === 'return' || key.name === 'enter') { finish(); resolve(password); password = ''; }
      else if (key.name === 'backspace') password = Array.from(password).slice(0, -1).join('');
      else if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text)) password += text;
    }
    stdin.on('keypress', onKey);
  });
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function main() {
  const email = argument('--email')?.trim().toLowerCase();
  if (!email || process.argv.some(arg => /^--.*(?:password|token|secret)/i.test(arg))) {
    throw new Error('Usage: node scripts/verify-existing-login.mjs --email you@example.com [--origin http://localhost:3000]');
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is unset. No database was started or seeded.');
  const originArg = argument('--origin');
  const origin = originArg ? new URL(originArg) : undefined;
  if (origin && (origin.origin !== originArg || origin.username || origin.password || !['http:', 'https:'].includes(origin.protocol))) {
    throw new Error('Supply an origin only, for example http://localhost:3000.');
  }
  if (origin && origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
    throw new Error('Only localhost may use HTTP.');
  }
  let password = await privatePassword();
  const conn = await mongoose.createConnection(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 }).asPromise();
  try {
    const collection = conn.db.collection('users');
    const user = await collection.findOne({ email });
    console.log(JSON.stringify({ database: conn.db.databaseName, accountFound: !!user, authSecretConfigured: (process.env.AUTH_SECRET?.length ?? 0) >= 32 }));
    if (!user) { process.exitCode = 1; return; }
    const matches = typeof user.passwordHash === 'string' && await bcrypt.compare(password, user.passwordHash);
    console.log(JSON.stringify({ passwordMatchesStoredHash: matches, role: user.role, status: user.status, emailVerified: !!user.emailVerifiedAt }));
    if (!matches) { process.exitCode = 1; return; }
    if (!origin) return;

    // Tokens stay in this process's memory. Response bodies and cookies are never printed.
    const cookies = new Map();
    async function request(path, body) {
      const response = await fetch(new URL(path, origin), {
        method: body ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(60000),
        headers: { 'content-type': 'application/json', origin: origin.origin, cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      for (const header of response.headers.getSetCookie()) {
        const pair = header.split(';', 1)[0], index = pair.indexOf('=');
        cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
      const data = await response.json().catch(() => ({}));
      return { status: response.status, data };
    }
    const login = await request('/api/auth/login', { email, password });
    console.log(JSON.stringify({ loginStatus: login.status, registrationRequired: login.data.registrationRequired === true, sessionCookieReceived: !!cookies.get('et_session') }));
    if (login.status !== 200 || login.data.registrationRequired || !cookies.get('et_session')) { process.exitCode = 1; return; }
    const me = await request('/api/auth/me');
    const home = user.role === 'OWNER' ? '/dashboard' : user.role === 'CLIENT' ? '/portal' : '/staff';
    const protectedPage = await request(home);
    const refresh = await request('/api/auth/refresh', {});
    const persisted = await request('/api/auth/me');
    const logout = await request('/api/auth/logout', {});
    const signedOut = await request('/api/auth/me');
    const again = await request('/api/auth/login', { email, password });
    const after = await collection.findOne({ _id: user._id });
    const preserved = ['email', 'passwordHash', 'role', 'permissions', 'permissionGrants', 'organizationId', 'emailVerifiedAt', 'status'];
    const unchanged = !!after && preserved.every(field => mongoose.mongo.BSON.EJSON.stringify(user[field] ?? null) === mongoose.mongo.BSON.EJSON.stringify(after[field] ?? null));
    const sameIdentity = me.data.id === String(user._id) && me.data.role === user.role && persisted.data.id === String(user._id) && persisted.data.role === user.role;
    console.log(JSON.stringify({ sessionStatus: me.status, protectedPageStatus: protectedPage.status, refreshStatus: refresh.status, persistedSessionStatus: persisted.status, logoutStatus: logout.status, signedOutStatus: signedOut.status, reloginStatus: again.status, sessionIdentityAndRoleMatch: sameIdentity, identityAndCredentialsUnchanged: unchanged }));
    const ok = me.status === 200 && protectedPage.status === 200 && refresh.status === 200 && persisted.status === 200 && logout.status === 200 && signedOut.status === 401 && again.status === 200 && sameIdentity && unchanged;
    await request('/api/auth/logout', {});
    cookies.clear();
    console.log(ok ? 'PASS: original credentials and API session lifecycle verified.' : 'FAIL: session lifecycle needs investigation.');
    if (!ok) process.exitCode = 1;
  } finally { password = ''; await conn.close(); }
}

main().catch(error => {
  // Driver and fetch errors can carry credentials/URLs; never print the error object.
  console.error(['Run this command in your own interactive terminal.', 'Cancelled.'].includes(error.message) ? error.message : 'Verification failed. Check arguments, database configuration and server availability. No credentials were printed.');
  process.exitCode = 1;
});
