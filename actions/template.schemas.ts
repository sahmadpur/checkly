import { z } from "zod";

export const itemSchema = z.object({
  type: z.enum(["CHECKBOX", "TEXT", "NUMBER", "PHOTO", "VIDEO", "SELECT"]),
  label: z.string().trim().min(1).max(200),
  required: z.boolean(),
  options: z.array(z.string().trim().max(100)).default([]),
  min: z.coerce.number().nullable().default(null),
  max: z.coerce.number().nullable().default(null),
});

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  items: z.array(itemSchema).min(1).max(100),
});
export type TemplateFormInput = z.input<typeof templateSchema>;
