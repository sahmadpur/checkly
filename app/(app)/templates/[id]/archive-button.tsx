"use client";
import { useState, useTransition } from "react";
import { archiveTemplateAction, unarchiveTemplateAction } from "@/actions/template";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";

export function ArchiveButton({ id, archived }: { id: string; archived: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-1">
      <Button variant="outline" size="sm" disabled={pending}
        onClick={() => start(async () => { const r = await (archived ? unarchiveTemplateAction(id) : archiveTemplateAction(id)); if (!r.ok) setError(r.error); })}>
        {archived ? "Unarchive" : "Archive"}
      </Button>
      <FormError message={error} />
    </div>
  );
}
