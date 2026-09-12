import { redirect } from "next/navigation";
import { NextRequest } from "next/server";
import { auth, unstable_update } from "@/lib/auth/config";
import { AppError } from "@/lib/errors";
import { assertMembership } from "@/lib/services/org";

/**
 * This is a state-changing GET by design: unstable_update can't run during layout render, so the
 * org switcher links here instead of calling a server action. It only ever switches among orgs
 * the signed-in user already belongs to (assertMembership below enforces that).
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const to = req.nextUrl.searchParams.get("to");
  if (!to) redirect("/no-org");
  let notMember = false;
  try {
    await assertMembership(session.user.id, to);
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") notMember = true;
    else throw e;
  }
  if (notMember) redirect("/no-org");
  await unstable_update({ activeOrgId: to } as never);
  redirect("/");
}
