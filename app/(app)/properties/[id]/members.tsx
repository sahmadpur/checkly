"use client";
import { useState, useTransition } from "react";
import { addPropertyMemberAction, removePropertyMemberAction } from "@/actions/property";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/form-error";
import { List, ListEmpty, ListRow } from "@/components/ui/list";
import { Section } from "@/components/section";

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
    <Section title="Members" description={canEdit ? "Only members can be assigned work here." : undefined}
      actions={canEdit && candidates.length > 0 && (
        <Select aria-label="Add member" className="w-44 [&>select]:h-9" disabled={pending} value=""
          onChange={(e) => e.target.value && act(() => addPropertyMemberAction(propertyId, e.target.value))}>
          <option value="">Add a member…</option>
          {candidates.map((c) => <option key={c.userId} value={c.userId}>{c.name}</option>)}
        </Select>
      )}>
      <List>
        {members.length === 0 && <ListEmpty>Nobody works here yet.</ListEmpty>}
        {members.map((m) => (
          <ListRow key={m.userId}>
            <span className="min-w-0 flex-1 truncate"><span className="font-medium">{m.name}</span> <span className="text-muted-foreground">{m.email ?? m.phone}</span></span>
            {canEdit && (
              <Button variant="ghost" size="sm" disabled={pending}
                onClick={() => act(() => removePropertyMemberAction(propertyId, m.userId))}>Remove</Button>
            )}
          </ListRow>
        ))}
      </List>
      <FormError message={error} />
    </Section>
  );
}
