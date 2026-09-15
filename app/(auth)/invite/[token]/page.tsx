import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth/config";
import { getInvite } from "@/lib/services/invite";
import { db } from "@/lib/db";
import { AuthIntro } from "@/components/auth-intro";
import { AcceptForm } from "./accept-form";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await getInvite(token);
  const t = await getTranslations("auth.invite");
  if (!invite) return <AuthIntro title={t("expiredTitle")}>{t("expiredBody")}</AuthIntro>;

  const session = await auth();
  let mode: "new" | "signed-in" | "needs-login" = "new";
  if (invite.existingUser) {
    if (!session?.user) mode = "needs-login";
    else {
      const me = await db.user.findUnique({ where: { id: session.user.id }, select: { email: true } });
      mode = me?.email === invite.email ? "signed-in" : "needs-login";
    }
  }
  const te = await getTranslations("enums");
  return (
    <>
      <AuthIntro title={t("title", { org: invite.orgName })}>{t("subtitle", { role: te(`role.${invite.role}`).toLowerCase(), email: invite.email })}</AuthIntro>
      <AcceptForm token={token} orgName={invite.orgName} email={invite.email} role={invite.role} mode={mode} />
    </>
  );
}
