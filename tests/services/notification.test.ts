import { describe, expect, test } from "vitest";
import { db } from "@/lib/db";
import {
  deletePushSubscription, getPreferences, listMine, markAllRead, markRead, notify, recipientsForSubmitted,
  savePushSubscription, setPreferences, unreadCount,
} from "@/lib/services/notification";
import { makeMember, makeOrg, makeProperty, makeUser } from "@/tests/helpers/db";

async function setup() {
  const org = await makeOrg();
  const owner = await makeUser({ name: "Owner" });
  const mgrIn = await makeUser({ name: "MgrIn" });
  const mgrOut = await makeUser({ name: "MgrOut" });
  const w = await makeUser({ name: "W" });
  await makeMember(org.id, owner.id, "OWNER");
  await makeMember(org.id, mgrIn.id, "MANAGER");
  await makeMember(org.id, mgrOut.id, "MANAGER");
  await makeMember(org.id, w.id, "WORKER");
  const prop = await makeProperty(org.id);
  await db.propertyMember.createMany({ data: [mgrIn.id, w.id].map((userId) => ({ propertyId: prop.id, userId })) });
  const ctx = (userId: string) => ({ userId, orgId: org.id });
  return { org, owner, mgrIn, mgrOut, w, prop, ctx };
}

test("recipientsForSubmitted: owners + property managers, excluding the submitter", async () => {
  const { org, owner, mgrIn, w, prop } = await setup();
  const ids = await recipientsForSubmitted(org.id, prop.id, w.id);
  expect(ids.sort()).toEqual([mgrIn.id, owner.id].sort());
});

describe("inbox", () => {
  test("notify, listMine (own only, newest first), unreadCount, markRead scoping, markAllRead", async () => {
    const { org, w, owner, ctx } = await setup();
    await notify([
      { orgId: org.id, userId: w.id, type: "ASSIGNED", title: "a", body: "", url: "/x" },
      { orgId: org.id, userId: w.id, type: "OVERDUE", title: "b", body: "", url: "/y" },
      { orgId: org.id, userId: owner.id, type: "SUBMITTED", title: "c", body: "", url: "/z" },
    ]);
    const mine = await listMine(ctx(w.id));
    expect(mine.map((n) => n.title)).toEqual(["b", "a"]);
    expect(await unreadCount(ctx(w.id))).toBe(2);
    await expect(markRead(ctx(owner.id), mine[0].id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await markRead(ctx(w.id), mine[0].id);
    expect(await unreadCount(ctx(w.id))).toBe(1);
    await markAllRead(ctx(w.id));
    expect(await unreadCount(ctx(w.id))).toBe(0);
    expect(await unreadCount(ctx(owner.id))).toBe(1);
  });

  test("markRead from another org is NOT_FOUND", async () => {
    const { org, w } = await setup();
    await notify([{ orgId: org.id, userId: w.id, type: "ASSIGNED", title: "a", body: "", url: "/x" }]);
    const n = await db.notification.findFirstOrThrow();
    const other = await makeOrg();
    const outsider = await makeUser();
    await makeMember(other.id, outsider.id, "OWNER");
    await expect(markRead({ userId: outsider.id, orgId: other.id }, n.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await db.notification.findUniqueOrThrow({ where: { id: n.id } })).readAt).toBeNull();
  });
});

describe("preferences and push subscriptions", () => {
  test("toggle preferences; save/replace/delete subscription; endpoint must be https", async () => {
    const { w, ctx } = await setup();
    expect(await getPreferences(ctx(w.id))).toEqual({ notifyPush: true, notifyEmail: true });
    await setPreferences(ctx(w.id), { notifyEmail: false });
    expect(await getPreferences(ctx(w.id))).toEqual({ notifyPush: true, notifyEmail: false });
    await expect(savePushSubscription(ctx(w.id), { endpoint: "http://insecure", keys: { p256dh: "a", auth: "b" } })).rejects.toMatchObject({ code: "INVALID" });
    await savePushSubscription(ctx(w.id), { endpoint: "https://push.example/1", keys: { p256dh: "a", auth: "b" }, userAgent: "ua" });
    await savePushSubscription(ctx(w.id), { endpoint: "https://push.example/1", keys: { p256dh: "a2", auth: "b2" } });
    const subs = await db.pushSubscription.findMany({ where: { userId: w.id } });
    expect(subs).toHaveLength(1);
    expect(subs[0].p256dh).toBe("a2");
    await deletePushSubscription(ctx(w.id), "https://push.example/1");
    expect(await db.pushSubscription.count()).toBe(0);
  });

  test("subscriptions are per user: another user cannot delete one, but saving the same endpoint takes it over", async () => {
    const { w, owner, ctx } = await setup();
    await savePushSubscription(ctx(w.id), { endpoint: "https://push.example/shared", keys: { p256dh: "a", auth: "b" } });
    await deletePushSubscription(ctx(owner.id), "https://push.example/shared");
    const still = await db.pushSubscription.findFirstOrThrow();
    expect(still.userId).toBe(w.id);
    // Same browser, new sign-in: the endpoint moves to whoever last subscribed on it.
    await savePushSubscription(ctx(owner.id), { endpoint: "https://push.example/shared", keys: { p256dh: "c", auth: "d" } });
    const subs = await db.pushSubscription.findMany();
    expect(subs).toHaveLength(1);
    expect(subs[0].userId).toBe(owner.id);
  });
});
