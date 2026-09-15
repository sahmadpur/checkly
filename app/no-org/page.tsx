import { getTranslations } from "next-intl/server";
import { logoutAction } from "@/actions/auth";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";

export default async function NoOrgPage() {
  const t = await getTranslations("auth.noOrg");
  const tc = await getTranslations("common");
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <Wordmark className="text-2xl" />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("body")}</p>
      </div>
      <form action={logoutAction}><Button variant="outline" type="submit">{tc("signOut")}</Button></form>
    </main>
  );
}
