import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import { isIP } from "node:net";

/** Opt-in, process-local DNS. Never changes Windows/network settings or TLS validation. */
export function configureMongoDns(value = process.env.MONGODB_DNS_SERVERS): void {
  if (!value?.trim()) return;
  const servers = value.split(",").map(server => server.trim());
  if (!servers.length || servers.length > 3 || servers.some(server => !isIP(server))) throw new Error("MONGODB_DNS_SERVERS must contain one to three DNS server IP addresses.");
  // Node binds these APIs independently when each module is first loaded.
  // A framework can load the promise resolver before the callback resolver is configured.
  if (JSON.stringify(dns.getServers()) !== JSON.stringify(servers)) dns.setServers(servers);
  if (JSON.stringify(dnsPromises.getServers()) !== JSON.stringify(servers)) dnsPromises.setServers(servers);
}

/** A missing database silently selects `test`, which is unsafe during migration. */
export function hasExplicitMongoDatabase(uri: string): boolean {
  const database = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/.exec(uri)?.[1];
  return !!database && database.trim().length > 0;
}
