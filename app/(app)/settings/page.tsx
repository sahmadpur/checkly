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
import { LogOut } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { LanguageSelect } from "@/components/language-select";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/section";
import { logoutAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";

export default async function SettingsPage() {
  const ctx = await requireUser();
  const role = await requireOrgRole(ctx, "WORKER");
  const org = await db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true, timezone: true } });
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true, phone: true, email: true } });
  const prefs = await getPreferences(ctx);
  const t = await getTranslations("settings");
  const tc = await getTranslations("common");
  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} />
      <ProfileForm name={user.name} phone={user.phone} />
      <Section title={t("language.title")} description={t("language.description")} card>
        <div className="space-y-1.5">
          <Label htmlFor="locale">{t("language.label")}</Label>
          <LanguageSelect />
        </div>
      </Section>
      <NotificationPrefs notifyPush={prefs.notifyPush} notifyEmail={prefs.notifyEmail} hasEmail={!!user.email} vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />
      {role === "OWNER" && <OrgForm name={org.name} />}
      {role === "OWNER" && <TimezoneForm timezone={org.timezone} options={TIMEZONES} unset={org.timezone === "UTC"} />}
      <PasswordForm />
      <form action={logoutAction}>
        <Button type="submit" variant="outline" className="w-full sm:w-auto"><LogOut aria-hidden /> {tc("signOut")}</Button>
      </form>
    </div>
  );
}
