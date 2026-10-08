import { EventEmitter } from "node:events";

/**
 * Realtime provider abstraction. The default in-memory implementation fans
 * events out to Server-Sent Event streams in the same Node process.
 *
 * Scaling to several instances: implement RealtimeProvider with Redis
 * pub/sub (or a managed service) and select it via REALTIME_PROVIDER.
 * The SSE endpoint and all publishers stay unchanged.
 */
export type RealtimeEvent =
  | { type: "message.created"; conversationId: string; organizationId: string; assignedTo?: string | null; participantIds: string[]; message: unknown }
  | { type: "conversation.updated"; conversationId: string; organizationId: string; assignedTo?: string | null; participantIds: string[]; conversation: unknown }
  | { type: "message.read"; conversationId: string; organizationId: string; userId: string }
  | { type: "notification"; unreadCount: number; notification?: unknown }
  | { type: "intel.updated"; countryCode: string; kind: "registrations" | "contacts" | "research"; count: number; companyIds?: string[]; at: string };

export interface RealtimeProvider {
  publish(channel: string, event: RealtimeEvent): void;
  subscribe(channel: string, handler: (event: RealtimeEvent) => void): () => void;
}

class InMemoryRealtimeProvider implements RealtimeProvider {
  private emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(0);
  }
  publish(channel: string, event: RealtimeEvent) {
    this.emitter.emit(channel, event);
  }
  subscribe(channel: string, handler: (event: RealtimeEvent) => void) {
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }
}

const g = globalThis as unknown as { __etRealtime?: RealtimeProvider };

export function getRealtime(): RealtimeProvider {
  g.__etRealtime ??= new InMemoryRealtimeProvider();
  return g.__etRealtime;
}

export const channels = {
  user: (id: string) => `user:${id}`,
  organization: (id: string) => `org:${id}`,
  internal: "internal",
  /** Company-intelligence updates — internal users with companies.read only. */
  intel: "intel",
};
