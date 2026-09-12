import { requireUser, requireOrgRole } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { OrgForm } from "./org-form";
import { PasswordForm } from "./password-form";

export default async function SettingsPage() {
  const ctx = await requireUser();
  const role = await requireOrgRole(ctx, "WORKER");
  const org = await db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Settings</h1>
      {role === "OWNER" && <OrgForm name={org.name} />}
      <PasswordForm />
    </div>
  );
}
