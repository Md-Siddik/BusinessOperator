import { Schema, type InferSchemaType } from "mongoose";
import { PROJECT_STATUSES, TASK_STATUSES } from "@/lib/constants";
import { defineModel, ObjectId, type Id } from "./_helpers";

const projectSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, maxlength: 5000 },
    status: { type: String, enum: PROJECT_STATUSES, default: "PLANNED" },
    startDate: Date,
    dueDate: Date,
    assignedStaff: { type: [{ type: ObjectId, ref: "User" }], default: [] },
    activity: {
      type: [{ at: { type: Date, default: Date.now }, actorId: { type: ObjectId, ref: "User" }, text: String, _id: false }],
      default: [],
    },
    createdBy: { type: ObjectId, ref: "User" },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

projectSchema.index({ status: 1, dueDate: 1 });
projectSchema.index({ assignedStaff: 1 });

export type ProjectDoc = InferSchemaType<typeof projectSchema> & { _id: Id; createdAt: Date; updatedAt: Date };
export const Project = defineModel("Project", projectSchema);

const projectTaskSchema = new Schema(
  {
    projectId: { type: ObjectId, ref: "Project", required: true, index: true },
    organizationId: { type: ObjectId, ref: "Organization", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    status: { type: String, enum: TASK_STATUSES, default: "TODO" },
    dueDate: Date,
    assigneeId: { type: ObjectId, ref: "User" },
    visibleToClient: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type ProjectTaskDoc = InferSchemaType<typeof projectTaskSchema> & { _id: Id; createdAt: Date };
export const ProjectTask = defineModel("ProjectTask", projectTaskSchema);
