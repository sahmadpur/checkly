"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { archiveTemplateAction, unarchiveTemplateAction } from "@/actions/template";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";

export function ArchiveButton({ id, archived }: { id: string; archived: boolean }) {
  const t = useTranslations("templates");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-1">
      <Button variant="outline" size="sm" disabled={pending}
        onClick={() => start(async () => { const r = await (archived ? unarchiveTemplateAction(id) : archiveTemplateAction(id)); if (!r.ok) setError(r.error); })}>
        {archived ? t("unarchive") : t("archive")}
      </Button>
      <FormError message={error} />
    </div>
  );
}
