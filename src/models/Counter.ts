import { Schema } from "mongoose";
import { defineModel } from "./_helpers";

/** Atomic sequence counters (e.g. human-friendly ticket numbers). */
const counterSchema = new Schema({ _id: { type: String, required: true }, seq: { type: Number, default: 0 } });
export const Counter = defineModel("Counter", counterSchema);

export async function nextSequence(name: string): Promise<number> {
  const doc = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, new: true }).lean<{ seq: number }>();
  return doc!.seq;
}
