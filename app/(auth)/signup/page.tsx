import { getTranslations } from "next-intl/server";
import { AuthIntro } from "@/components/auth-intro";
import { SignupForm } from "./signup-form";

export default async function SignupPage() {
  const t = await getTranslations("auth.signup");
  return (
    <>
      <AuthIntro title={t("title")}>{t("subtitle")}</AuthIntro>
      <SignupForm />
    </>
  );
}
