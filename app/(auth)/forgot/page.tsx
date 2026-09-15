import { getTranslations } from "next-intl/server";
import { AuthIntro } from "@/components/auth-intro";
import { ForgotForm } from "./forgot-form";

export default async function ForgotPage() {
  const t = await getTranslations("auth.forgot");
  return (
    <>
      <AuthIntro title={t("title")}>{t("subtitle")}</AuthIntro>
      <ForgotForm />
    </>
  );
}
