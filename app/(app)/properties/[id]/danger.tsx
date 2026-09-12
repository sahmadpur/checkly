"use client";
import { useState, useTransition } from "react";
import { deletePropertyAction } from "@/actions/property";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";

export function DeleteProperty({ id, name }: { id: string; name: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Button variant="destructive" size="sm" disabled={pending}
        onClick={() => {
          if (confirm(`Delete "${name}"? This cannot be undone.`)) {
            start(async () => {
              const res = await deletePropertyAction(id);
              if (res && !res.ok) setError(res.error);
            });
          }
        }}>
        Delete property
      </Button>
      <FormError message={error} />
    </div>
  );
}
