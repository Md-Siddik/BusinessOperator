import { expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";

it("opens a new connection after the cached connection has disconnected", async () => {
  // The setup hook provides an isolated MongoDB and a fulfilled cached promise.
  const state = (globalThis as unknown as { __etMongo: { conn?: typeof mongoose; promise?: Promise<typeof mongoose> } }).__etMongo;
  const previous = { conn: state.conn, promise: state.promise };
  const ready = vi.spyOn(mongoose.connection, "readyState", "get").mockReturnValue(0);
  const connect = vi.spyOn(mongoose, "connect").mockResolvedValue(mongoose);
  try {
    await connectToDatabase();
    expect(connect).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledWith(process.env.MONGODB_URI, expect.objectContaining({ serverSelectionTimeoutMS: 10_000 }));
  } finally {
    ready.mockRestore();
    connect.mockRestore();
    Object.assign(state, previous);
  }
});
