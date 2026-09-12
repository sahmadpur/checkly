import { z } from "zod";

export const inviteSchema = z.object({
  email: z.string().trim().pipe(z.email()),
  role: z.enum(["OWNER", "MANAGER", "WORKER"]),
  propertyIds: z.array(z.string()).default([]),
});

export const acceptNewSchema = z.object({
  token: z.string().length(64),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(200),
  phone: z.string().trim().max(30).optional(),
});
