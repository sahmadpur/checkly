import { z } from "zod";

const numberOrNull = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().nullable());

export const itemSchema = z.object({
  type: z.enum(["CHECKBOX", "TEXT", "NUMBER", "PHOTO", "VIDEO", "SELECT"]),
  label: z.string().trim().min(1).max(200),
  required: z.boolean(),
  options: z.array(z.string().trim().max(100)).default([]),
  // An empty <input type="number"> posts "", which z.coerce.number() would turn into 0.
  min: numberOrNull,
  max: numberOrNull,
});

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  items: z.array(itemSchema).min(1).max(100),
});
export type TemplateFormInput = z.input<typeof templateSchema>;
