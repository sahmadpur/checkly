import { z } from "zod";

export const assignSchema = z.object({
  templateId: z.string().min(1),
  propertyId: z.string().min(1),
  assigneeIds: z.array(z.string().min(1)).min(1),
  dueAt: z.string().datetime().transform((s) => new Date(s)),
});

export const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CHECKBOX"), checked: z.boolean() }),
  z.object({ type: z.literal("TEXT"), text: z.string().max(2000) }),
  z.object({ type: z.literal("NUMBER"), number: z.number() }),
  z.object({ type: z.literal("SELECT"), choice: z.string().min(1) }),
  z.object({ type: z.literal("PHOTO"), fileKey: z.string().min(1), fileType: z.string().min(1) }),
  z.object({ type: z.literal("VIDEO"), fileKey: z.string().min(1), fileType: z.string().min(1) }),
]);

export const reviewSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().trim().max(2000).optional(),
});

export const uploadRequestSchema = z.object({
  instanceId: z.string().min(1),
  itemId: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});
