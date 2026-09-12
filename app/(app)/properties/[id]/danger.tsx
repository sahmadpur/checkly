"use client";
import { useTransition } from "react";
import { deletePropertyAction } from "@/actions/property";
import { Button } from "@/components/ui/button";

export function DeleteProperty({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="destructive" size="sm" disabled={pending}
      onClick={() => { if (confirm(`Delete "${name}"? This cannot be undone.`)) start(async () => { await deletePropertyAction(id); }); }}>
      Delete property
    </Button>
  );
}
