import { z } from "zod";
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  userAgent: z.string().max(300).optional(),
});
export const preferencesSchema = z.object({ notifyPush: z.boolean().optional(), notifyEmail: z.boolean().optional() });
