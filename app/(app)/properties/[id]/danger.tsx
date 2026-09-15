"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { deletePropertyAction } from "@/actions/property";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";

export function DeleteProperty({ id, name }: { id: string; name: string }) {
  const t = useTranslations("properties.danger");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 p-4">
      <div>
        <h2 className="text-base font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("body")}</p>
        <FormError message={error} />
      </div>
      <Button variant="destructive" disabled={pending}
        onClick={() => {
          if (confirm(t("confirm", { name }))) {
            start(async () => {
              const res = await deletePropertyAction(id);
              if (res && !res.ok) setError(res.error);
            });
          }
        }}>
        {t("button")}
      </Button>
    </section>
  );
}
