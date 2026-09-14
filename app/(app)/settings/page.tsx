import { requireUser, requireOrgRole } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { TIMEZONES } from "@/lib/timezones";
import { OrgForm } from "./org-form";
import { PasswordForm } from "./password-form";
import { ProfileForm } from "./profile-form";
import { TimezoneForm } from "./timezone-form";

export default async function SettingsPage() {
  const ctx = await requireUser();
  const role = await requireOrgRole(ctx, "WORKER");
  const org = await db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true, timezone: true } });
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true, phone: true } });
  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Settings</h1>
      <ProfileForm name={user.name} phone={user.phone} />
      {role === "OWNER" && <OrgForm name={org.name} />}
      {role === "OWNER" && (
        <TimezoneForm timezone={org.timezone} options={TIMEZONES} unset={org.timezone === "UTC"} />
      )}
      <PasswordForm />
    </div>
  );
}
