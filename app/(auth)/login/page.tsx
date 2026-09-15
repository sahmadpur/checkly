import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth/config";
import { AuthIntro } from "@/components/auth-intro";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const session = await auth();
  if (session?.user) redirect("/");
  const { next, reset } = await searchParams;
  const t = await getTranslations("auth.login");
  return (
    <>
      <AuthIntro title={t("title")}>{t("subtitle")}</AuthIntro>
      <LoginForm next={next} notice={reset ? t("passwordUpdated") : undefined} />
    </>
  );
}
