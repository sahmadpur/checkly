import { z } from "zod";

export const propertySchema = z.object({
  name: z.string().trim().min(1).max(100),
  address: z.string().trim().max(200).optional().or(z.literal("")),
});
