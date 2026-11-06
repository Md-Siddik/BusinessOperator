/** Read-only diagnostics. Never log connection strings, emails, hashes or raw driver errors. */
import nextEnv from '@next/env';
import mongoose from 'mongoose';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import { isIP } from 'node:net';
nextEnv.loadEnvConfig(process.cwd());
if (process.env.MONGODB_DNS_SERVERS?.trim()) {
  const servers = process.env.MONGODB_DNS_SERVERS.split(',').map(value => value.trim());
  if (!servers.length || servers.length > 3 || servers.some(value => !isIP(value))) throw new Error('Invalid MONGODB_DNS_SERVERS configuration.');
  dns.setServers(servers);
  dnsPromises.setServers(servers);
}
for (const [label, uri] of [['source', process.env.OLD_MONGODB_URI], ['destination', process.env.NEW_MONGODB_URI || process.env.MONGODB_URI]]) {
  if (!uri) { console.log(JSON.stringify({ label, configured: false })); continue; }
  const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db();
    const users = db.collection('users');
    console.log(JSON.stringify({ label, connected: true, explicitDatabase: db.databaseName !== 'test', users: await users.countDocuments(), usersWithPasswordHash: await users.countDocuments({ passwordHash: { $type: 'string', $ne: '' } }), organizations: await db.collection('organizations').countDocuments(), authSecretConfigured: (process.env.AUTH_SECRET?.length ?? 0) >= 32 }));
  } catch (error) {
    const code = error?.code ?? error?.cause?.code;
    console.log(JSON.stringify({ label, connected: false, error: ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEOUT', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code) ? code : error?.name === 'MongoServerError' && error.code === 18 ? 'AUTHENTICATION_FAILED' : 'CONNECTION_FAILED' }));
    process.exitCode = 1;
  } finally { await client.close().catch(() => undefined); }
}
