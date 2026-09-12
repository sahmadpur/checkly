import { expect, test, vi } from "vitest";
import * as email from "@/lib/email";
import { acceptInvite, createInvite, getInvite, listInvites, revokeInvite } from "@/lib/services/invite";
import { makeMember, makeOrg, makeProperty, makeUser } from "@/tests/helpers/db";
import { db } from "@/lib/db";
import { authenticate } from "@/lib/services/auth";

async function setup() {
  const org = await makeOrg("Acme");
  const mgr = await makeUser({ name: "Mgr" });
  await makeMember(org.id, mgr.id, "MANAGER");
  const prop = await makeProperty(org.id);
  const ctx = { userId: mgr.id, orgId: org.id };
  const spy = vi.spyOn(email, "sendMail").mockResolvedValue();
  return { org, mgr, prop, ctx, spy };
}

const tokenFrom = (spy: ReturnType<typeof vi.spyOn>) =>
  (spy.mock.calls.at(-1)![0] as { html: string }).html.match(/invite\/([0-9a-f]{64})/)![1];

test("manager cannot invite an owner", async () => {
  const { ctx, prop } = await setup();
  await expect(createInvite(ctx, { email: "x@test.local", role: "OWNER", propertyIds: [prop.id] }))
    .rejects.toMatchObject({ code: "FORBIDDEN" });
});

test("new user accepts invite: user, membership, property membership created", async () => {
  const { ctx, org, prop, spy } = await setup();
  await createInvite(ctx, { email: "New@Test.local", role: "WORKER", propertyIds: [prop.id] });
  const token = tokenFrom(spy);

  const info = await getInvite(token);
  expect(info).toMatchObject({ orgName: "Acme", email: "new@test.local", role: "WORKER", existingUser: false });

  const { userId } = await acceptInvite(token, { name: "Newbie", password: "secret123" });
  expect(await db.orgMember.findUnique({ where: { orgId_userId: { orgId: org.id, userId } } })).toMatchObject({ role: "WORKER" });
  expect(await db.propertyMember.count({ where: { propertyId: prop.id, userId } })).toBe(1);
  expect(await authenticate("new@test.local", "secret123")).not.toBeNull();
  expect(await getInvite(token)).toBeNull(); // accepted
});

test("existing user accepts invite by userId; email must match", async () => {
  const { ctx, org, prop, spy } = await setup();
  const existing = await makeUser({ email: "ex@test.local" });
  const other = await makeUser({ email: "other@test.local" });
  await createInvite(ctx, { email: "ex@test.local", role: "MANAGER", propertyIds: [prop.id] });
  const token = tokenFrom(spy);
  expect((await getInvite(token))?.existingUser).toBe(true);
  await expect(acceptInvite(token, { userId: other.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  const res = await acceptInvite(token, { userId: existing.id });
  expect(res).toEqual({ userId: existing.id, orgId: org.id });
});

test("expired invites are invalid; revoke deletes", async () => {
  const { ctx, prop, spy } = await setup();
  await createInvite(ctx, { email: "a@test.local", role: "WORKER", propertyIds: [prop.id] });
  const token = tokenFrom(spy);
  await db.invite.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } });
  expect(await getInvite(token)).toBeNull();
  await expect(acceptInvite(token, { userId: ctx.userId })).rejects.toMatchObject({ code: "INVALID" });

  const [inv] = await listInvites(ctx);
  await revokeInvite(ctx, inv.id);
  expect(await listInvites(ctx)).toEqual([]);
});

test("propertyIds outside the org are rejected", async () => {
  const { ctx } = await setup();
  const foreign = await makeProperty((await makeOrg()).id);
  await expect(createInvite(ctx, { email: "a@test.local", role: "WORKER", propertyIds: [foreign.id] }))
    .rejects.toMatchObject({ code: "INVALID" });
});
