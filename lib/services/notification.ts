import { NotificationType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { Ctx, requireOrgRole } from "@/lib/auth/guard";
import { invalid, notFound } from "@/lib/errors";

export type NotifyRow = { orgId: string; userId: string; type: NotificationType; instanceId?: string | null; title: string; body: string; url: string };

export async function notify(rows: NotifyRow[], tx: Prisma.TransactionClient | typeof db = db) {
  if (rows.length === 0) return;
  await tx.notification.createMany({ data: rows.map((r) => ({ ...r, instanceId: r.instanceId ?? null })) });
}

/** Org OWNERs plus MANAGERs who are members of the property, minus the submitter. */
export async function recipientsForSubmitted(orgId: string, propertyId: string, excludeUserId: string) {
  const members = await db.orgMember.findMany({
    where: {
      orgId, userId: { not: excludeUserId },
      OR: [{ role: "OWNER" }, { role: "MANAGER", user: { propertyMembers: { some: { propertyId } } } }],
    },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

export async function listMine(ctx: Ctx, limit = 50) {
  await requireOrgRole(ctx, "WORKER");
  return db.notification.findMany({
    where: { orgId: ctx.orgId, userId: ctx.userId },
    // createMany can give same-millisecond rows equal createdAt; cuids are monotonic, so use them as the tiebreaker.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit,
    select: { id: true, type: true, title: true, body: true, url: true, createdAt: true, readAt: true },
  });
}

export async function unreadCount(ctx: Ctx) {
  await requireOrgRole(ctx, "WORKER");
  return db.notification.count({ where: { orgId: ctx.orgId, userId: ctx.userId, readAt: null } });
}

export async function markRead(ctx: Ctx, id: string) {
  await requireOrgRole(ctx, "WORKER");
  const n = await db.notification.updateMany({ where: { id, orgId: ctx.orgId, userId: ctx.userId, readAt: null }, data: { readAt: new Date() } });
  if (n.count === 0) {
    const exists = await db.notification.findFirst({ where: { id, orgId: ctx.orgId, userId: ctx.userId }, select: { id: true } });
    if (!exists) throw notFound("Notification not found");
  }
}

export async function markAllRead(ctx: Ctx) {
  await requireOrgRole(ctx, "WORKER");
  await db.notification.updateMany({ where: { orgId: ctx.orgId, userId: ctx.userId, readAt: null }, data: { readAt: new Date() } });
}

export async function getPreferences(ctx: Ctx) {
  const u = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { notifyPush: true, notifyEmail: true } });
  return u;
}

export async function setPreferences(ctx: Ctx, p: { notifyPush?: boolean; notifyEmail?: boolean }) {
  await db.user.update({ where: { id: ctx.userId }, data: p });
}

const b64url = /^[A-Za-z0-9_-]+=*$/;

/**
 * Upsert by endpoint, reassigning it to the current user. A push endpoint identifies one
 * browser profile, not one account: on a shared device the previous user's subscription is
 * dead the moment someone else signs in and subscribes, so taking it over is what keeps a
 * single row per browser and stops notifications going to the wrong person.
 */
export async function savePushSubscription(ctx: Ctx, sub: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string | null }) {
  if (!/^https:\/\//.test(sub.endpoint)) throw invalid("Push endpoint must be https");
  if (!b64url.test(sub.keys.p256dh) || !b64url.test(sub.keys.auth)) throw invalid("Invalid subscription keys");
  await db.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId: ctx.userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: sub.userAgent ?? null },
    update: { userId: ctx.userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: sub.userAgent ?? null },
  });
}

export async function deletePushSubscription(ctx: Ctx, endpoint: string) {
  await db.pushSubscription.deleteMany({ where: { endpoint, userId: ctx.userId } });
}

export const listPushSubscriptions = (userId: string) => db.pushSubscription.findMany({ where: { userId } });
