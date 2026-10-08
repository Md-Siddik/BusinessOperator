import mongoose, { type Model, type Schema } from "mongoose";

/** Register a model once (safe across dev hot reloads). */
export function defineModel<T>(name: string, schema: Schema<T>): Model<T> {
  return (mongoose.models[name] as Model<T>) ?? mongoose.model<T>(name, schema);
}

export const { ObjectId } = mongoose.Schema.Types;
export type Id = mongoose.Types.ObjectId;
