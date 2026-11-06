/** Read-only check of current operations for the configured source database user. */
import nextEnv from '@next/env';
import mongoose from 'mongoose';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import { isIP } from 'node:net';
nextEnv.loadEnvConfig(process.cwd());
if (process.env.MONGODB_DNS_SERVERS?.trim()) {
  const servers = process.env.MONGODB_DNS_SERVERS.split(',').map(s => s.trim());
  if (servers.some(s => !isIP(s))) throw new Error('Invalid DNS configuration');
  dns.setServers(servers);
  dnsPromises.setServers(servers);
}
const client = new mongoose.mongo.MongoClient(process.env.OLD_MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
try {
  await client.connect();
  const database = client.db().databaseName;
  const operations = await client.db('admin').aggregate([{ $currentOp: { allUsers: false, idleConnections: false } }]).toArray();
  const writers = operations.filter(op => op.active && (op.ns?.startsWith(database + '.') || op.command?.$db === database) &&
    (['insert', 'update', 'remove'].includes(op.op) || ['insert', 'update', 'delete', 'findAndModify', 'bulkWrite', 'create', 'createIndexes', 'drop', 'dropDatabase', 'renameCollection'].some(key => op.command?.[key] !== undefined) || op.command?.pipeline?.some(stage => stage.$out || stage.$merge)));
  console.log(JSON.stringify({ sourceDatabase: database, visibleActiveWriters: writers.length, scope: 'current database user', localSchedulersDisabled: process.env.REGISTRY_SCHEDULER === 'off' && process.env.OPPORTUNITY_SCHEDULER === 'off' && process.env.UK_STREAM_WORKER === 'off' }));
  if (writers.length) process.exitCode = 1;
} catch (error) { console.error(JSON.stringify({ sourceCurrentOperationCheckAvailable: false, errorCode: typeof error.code === 'number' ? error.code : null, databaseModified: false })); process.exitCode = 1; }
finally { await client.close(); }
