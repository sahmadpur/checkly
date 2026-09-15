import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";

export async function Forbidden() {
  const t = await getTranslations("common.forbidden");
  return (
    <div className="mx-auto max-w-sm space-y-3 py-16 text-center">
      <p className="text-lg font-semibold">{t("title")}</p>
      <p className="text-sm text-muted-foreground">{t("body")}</p>
      <Button variant="outline" render={<Link href="/" />}>{t("back")}</Button>
    </div>
  );
}
