import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getPasswordReset } from "@/lib/services/auth";
import { AuthIntro } from "@/components/auth-intro";
import { Button } from "@/components/ui/button";
import { ResetForm } from "./reset-form";

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = await getPasswordReset(token);
  const t = await getTranslations("auth.reset");
  if (!valid) {
    return (
      <>
        <AuthIntro title={t("expiredTitle")}>{t("expiredBody")}</AuthIntro>
        <Button className="w-full" render={<Link href="/forgot" />}>{t("requestNew")}</Button>
      </>
    );
  }
  return (
    <>
      <AuthIntro title={t("title")}>{t("subtitle")}</AuthIntro>
      <ResetForm token={token} />
    </>
  );
}
