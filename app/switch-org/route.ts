import { redirect } from "next/navigation";
import { NextRequest } from "next/server";
import { auth, unstable_update } from "@/lib/auth/config";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const to = req.nextUrl.searchParams.get("to");
  if (!to) redirect("/no-org");
  const member = await db.orgMember.findUnique({ where: { orgId_userId: { orgId: to, userId: session.user.id } } });
  if (!member) redirect("/no-org");
  await unstable_update({ activeOrgId: to } as never);
  redirect("/");
}
