"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function AppError({ reset }: { reset: () => void }) {
  const t = useTranslations("common.error");
  return (
    <div className="mx-auto max-w-sm space-y-3 py-16 text-center">
      <p className="text-lg font-semibold">{t("title")}</p>
      <p className="text-sm text-muted-foreground">{t("body")}</p>
      <Button variant="outline" onClick={reset}>{t("retry")}</Button>
    </div>
  );
}
