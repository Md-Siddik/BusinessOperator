import "server-only";
import { createHmac } from "node:crypto";
import { Schema } from "mongoose";
import { defineModel } from "@/models/_helpers";
import { Errors } from "@/lib/errors";
import type { RateLimitRule } from "@/lib/rate-limit";
const schema = new Schema({ _id: String, count: { type: Number, default: 0 }, expiresAt: Date });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const Bucket = defineModel("AuthRateLimit", schema);
/** Shared MongoDB budget: process restarts and multiple app instances cannot reset it. */
export async function enforceDurableAuthLimit(rule: RateLimitRule, ip: string) {
  const key = process.env.AUTH_SECRET;
  if (!key || key.length < 32) throw new Error("AUTH_SECRET is required for authentication rate limiting.");
  const window = Math.floor(Date.now() / rule.windowMs);
  const id = rule.bucket + ":" + window + ":" + createHmac("sha256", key).update(ip).digest("hex");
  const increment = () => Bucket.findOneAndUpdate({ _id: id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * rule.windowMs) } }, { upsert: true, new: true }).lean<{ count: number }>();
  let bucket;
  try { bucket = await increment(); }
  catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
    bucket = await increment();
  }
  if (!bucket || bucket.count > rule.limit) throw Errors.tooManyRequests();
}
