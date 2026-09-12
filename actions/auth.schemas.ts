import { z } from "zod";

export const signupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().pipe(z.email()),
  phone: z.string().trim().max(30).optional(),
  password: z.string().min(8).max(200),
  orgName: z.string().trim().min(1).max(100),
});

export const loginSchema = z.object({ identifier: z.string().trim().min(1), password: z.string().min(1) });

export const resetSchema = z.object({ token: z.string().length(64), password: z.string().min(8).max(200) });

export const changePasswordSchema = z.object({ current: z.string().min(1), next: z.string().min(8).max(200) });

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(30).optional(),
});
