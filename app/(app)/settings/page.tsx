import { requireUser, requireOrgRole } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { TIMEZONES } from "@/lib/timezones";
import { getPreferences } from "@/lib/services/notification";
import { PageHeader } from "@/components/page-header";
import { OrgForm } from "./org-form";
import { PasswordForm } from "./password-form";
import { ProfileForm } from "./profile-form";
import { TimezoneForm } from "./timezone-form";
import { NotificationPrefs } from "./notification-prefs";

export default async function SettingsPage() {
  const ctx = await requireUser();
  const role = await requireOrgRole(ctx, "WORKER");
  const org = await db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true, timezone: true } });
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true, phone: true, email: true } });
  const prefs = await getPreferences(ctx);
  return (
    <div className="space-y-8">
      <PageHeader title="Settings" />
      <ProfileForm name={user.name} phone={user.phone} />
      <NotificationPrefs notifyPush={prefs.notifyPush} notifyEmail={prefs.notifyEmail} hasEmail={!!user.email} vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />
      {role === "OWNER" && <OrgForm name={org.name} />}
      {role === "OWNER" && <TimezoneForm timezone={org.timezone} options={TIMEZONES} unset={org.timezone === "UTC"} />}
      <PasswordForm />
    </div>
  );
}
