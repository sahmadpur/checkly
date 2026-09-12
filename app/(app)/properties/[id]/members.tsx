"use client";
import { useState, useTransition } from "react";
import { addPropertyMemberAction, removePropertyMemberAction } from "@/actions/property";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";

type Member = { userId: string; name: string; email: string | null; phone: string | null };
type Candidate = { userId: string; name: string };

export function PropertyMembers({ propertyId, members, candidates, canEdit }: {
  propertyId: string; members: Member[]; candidates: Candidate[]; canEdit: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => { const r = await fn(); if (!r.ok) setError(r.error ?? "Failed"); });

  return (
    <section className="space-y-3">
      <h2 className="font-medium">Members</h2>
      <ul className="divide-y rounded-md border">
        {members.length === 0 && <li className="p-3 text-sm text-muted-foreground">Nobody assigned yet.</li>}
        {members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between p-3 text-sm">
            <span>{m.name} <span className="text-muted-foreground">{m.email ?? m.phone}</span></span>
            {canEdit && (
              <Button variant="ghost" size="sm" disabled={pending}
                onClick={() => act(() => removePropertyMemberAction(propertyId, m.userId))}>Remove</Button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && candidates.length > 0 && (
        <select aria-label="Add member" className="rounded-md border bg-background px-2 py-1 text-sm" disabled={pending} value=""
          onChange={(e) => e.target.value && act(() => addPropertyMemberAction(propertyId, e.target.value))}>
          <option value="">Add a member…</option>
          {candidates.map((c) => <option key={c.userId} value={c.userId}>{c.name}</option>)}
        </select>
      )}
      <FormError message={error} />
    </section>
  );
}
