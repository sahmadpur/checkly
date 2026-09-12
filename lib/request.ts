import { headers } from "next/headers";
import { rateLimit } from "@/lib/ratelimit";
import { invalid } from "@/lib/errors";

export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/** Throws INVALID when the caller exceeds `capacity` calls per window for this bucket name. */
export async function throttle(bucket: string, capacity = 10, refillPerSec = 0.2) {
  const ip = await clientIp();
  if (!rateLimit(`${bucket}:${ip}`, { capacity, refillPerSec })) throw invalid("Too many attempts. Try again in a minute.");
}

/** Restricts a post-login redirect target to a same-origin path, rejecting protocol-relative URLs like "//evil.com". */
export const safeNext = (next?: string) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
