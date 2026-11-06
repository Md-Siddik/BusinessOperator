/** Read-only network probes. Credentials and constructed connection strings are never printed or saved. */
import nextEnv from '@next/env';
import dns from 'node:dns/promises';
import tls from 'node:tls';
import net from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import mongoose from 'mongoose';

nextEnv.loadEnvConfig(process.cwd());
const uri = process.env.NEW_MONGODB_URI || process.env.MONGODB_URI;
const report = { at: new Date().toISOString(), node: process.version, mongoose: mongoose.version, driver: mongoose.mongo.MongoClient.name, checks: [] };
const checks = report.checks;
function safeError(error) {
  const code = error?.code || error?.cause?.code;
  const allowed = ['ECONNREFUSED', 'ENOTFOUND', 'ENODATA', 'ETIMEOUT', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNRESET', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID'];
  if (allowed.includes(code)) return code;
  if (code === 18) return 'AUTHENTICATION_FAILED';
  if (code === 13) return 'INSUFFICIENT_DATABASE_PERMISSIONS';
  return ['MongoServerSelectionError', 'MongoNetworkError', 'MongoParseError', 'MongoServerError', 'AbortError', 'TimeoutError'].includes(error?.name) ? error.name : 'FAILED';
}
async function probe(label, work) {
  try { const value = await work(); checks.push({ label, ok: true, value }); return value; }
  catch (error) { checks.push({ label, ok: false, error: safeError(error) }); return null; }
}
function tlsProbe(host, port) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: true }, () => {
      const result = { authorized: socket.authorized, protocol: socket.getProtocol() };
      socket.end(); resolve(result);
    });
    socket.setTimeout(8000, () => socket.destroy(Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' })));
    socket.on('error', reject);
  });
}
async function main() {
  if (!uri) throw new Error('Destination URI is not configured.');
  const parsed = new URL(uri);
  if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol)) throw new Error('Unsupported MongoDB URI scheme.');
  checks.push({ label: 'configuration', ok: true, value: { srv: parsed.protocol === 'mongodb+srv:', explicitDatabase: parsed.pathname.length > 1, credentialsPresent: !!parsed.username && !!parsed.password, tlsDisabled: parsed.searchParams.get('tls') === 'false', systemDnsServers: dns.getServers(), proxyConfigured: !!(process.env.HTTPS_PROXY || process.env.HTTP_PROXY) } });
  await probe('public-egress-ipv4', async () => {
    const response = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('IP probe failed');
    const { ip } = await response.json();
    if (net.isIP(ip) !== 4) throw new Error('Expected an IPv4 address');
    return ip;
  });
  let records = null, txt = null;
  if (parsed.protocol === 'mongodb+srv:') {
    const hostname = parsed.hostname;
    if (!hostname.endsWith('.mongodb.net')) throw new Error('This diagnostic is limited to Atlas hosts.');
    const srvName = `_mongodb._tcp.${hostname}`;
    records = await probe('system-srv', () => dns.resolveSrv(srvName));
    txt = await probe('system-txt', () => dns.resolveTxt(hostname));
    for (const server of ['1.1.1.1', '8.8.8.8']) {
      const resolver = new dns.Resolver({ timeout: 3000, tries: 1 }); resolver.setServers([server]);
      const answer = await probe(`srv-via-${server}`, () => resolver.resolveSrv(srvName));
      const text = await probe(`txt-via-${server}`, () => resolver.resolveTxt(hostname));
      records ||= answer; txt ||= text;
    }
    // Independent encrypted DNS: verifies whether SRV records exist even if local DNS refuses queries.
    for (const provider of ['https://cloudflare-dns.com/dns-query', 'https://dns.google/resolve']) {
      for (const [type, name] of [['SRV', srvName], ['TXT', hostname]]) {
        const answer = await probe(`${new URL(provider).hostname}-${type}`, async () => {
          const response = await fetch(`${provider}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(8000) });
          const data = await response.json();
          return { status: data.Status, answers: (data.Answer || []).filter(a => a.type === (type === 'SRV' ? 33 : 16)).map(a => a.data) };
        });
        if (type === 'SRV' && !records && answer?.status === 0 && answer.answers.length) records = answer.answers.map(value => { const [priority, weight, port, name] = value.split(/\s+/); return { priority: +priority, weight: +weight, port: +port, name: name.replace(/\.$/, '') }; });
        if (type === 'TXT' && !txt && answer?.status === 0 && answer.answers.length === 1) txt = [[answer.answers[0].replace(/^"|"$/g, '')]];
      }
    }
    if (records?.length) {
      const suffix = hostname.slice(hostname.indexOf('.'));
      if (records.some(r => !r.name.endsWith(suffix) || !Number.isInteger(r.port) || r.port < 1 || r.port > 65535)) throw new Error('SRV results do not match the Atlas parent domain.');
      for (const record of records) {
        await probe(`host-dns-${record.name}`, () => dns.lookup(record.name, { all: true }));
        await probe(`tls-${record.name}`, () => tlsProbe(record.name, record.port));
      }
      // Construct a standard URI only in memory. Preserve credentials, database, TLS and original options.
      if (!txt || txt.length !== 1) checks.push({ label: 'standard-uri', ok: false, error: 'TXT_OPTIONS_NOT_VERIFIED' });
      else {
        const options = new URLSearchParams(txt[0].join(''));
        for (const key of options.keys()) if (!['authSource', 'replicaSet', 'loadBalanced'].includes(key)) throw new Error('Unexpected DNS TXT option.');
        for (const [key, value] of parsed.searchParams) options.set(key, value);
        options.delete('srvMaxHosts'); options.delete('srvServiceName'); options.set('tls', 'true');
        const authority = parsed.username ? `${parsed.username}:${parsed.password}@` : '';
        const standard = `mongodb://${authority}${records.map(r => `${r.name}:${r.port}`).join(',')}${parsed.pathname || '/'}?${options}`;
        await probe('standard-uri-authenticated-ping', async () => {
          const client = new mongoose.mongo.MongoClient(standard, { serverSelectionTimeoutMS: 12000, connectTimeoutMS: 8000 });
          try { await client.connect(); await client.db().command({ ping: 1 }); return { connected: true, authenticationAndTlsVerified: true }; }
          finally { await client.close().catch(() => undefined); }
        });
      }
    }
  }
  const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 12000, connectTimeoutMS: 8000 });
  await probe('original-uri-authenticated-ping', async () => {
    try { await client.connect(); await client.db().command({ ping: 1 }); return { connected: true }; }
    finally { await client.close().catch(() => undefined); }
  });
  if (process.env.MONGODB_DNS_SERVERS?.trim()) {
    const servers = process.env.MONGODB_DNS_SERVERS.split(',').map(value => value.trim());
    if (!servers.length || servers.length > 3 || servers.some(value => !net.isIP(value))) throw new Error('Invalid DNS configuration');
    dns.setServers(servers);
    await probe('configured-dns-uri-authenticated-ping', async () => {
      const configured = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 12000, connectTimeoutMS: 8000 });
      try { await configured.connect(); await configured.db().command({ ping: 1 }); return { connected: true, database: configured.db().databaseName }; }
      finally { await configured.close().catch(() => undefined); }
    });
  }
  await mkdir('storage/backups/migration', { recursive: true });
  await writeFile('storage/backups/migration/atlas-network-diagnostic.json', JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}
main().catch(() => { console.error('Diagnostic could not complete. No connection setting or database data was changed.'); process.exitCode = 1; });
