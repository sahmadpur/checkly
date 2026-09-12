"use client";
import { useState, useTransition } from "react";
import { changeRoleAction, removeMemberAction } from "@/actions/member";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";

export function MemberRow({ member, isOwner, isSelf }: {
  member: { userId: string; name: string; email: string | null; phone: string | null; role: string; propertyCount: number };
  isOwner: boolean; isSelf: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
      <div>
        <div>{member.name}{isSelf && <span className="text-muted-foreground"> (you)</span>}</div>
        <div className="text-muted-foreground">{member.email ?? member.phone} · {member.propertyCount} propert{member.propertyCount === 1 ? "y" : "ies"}</div>
        <FormError message={error} />
      </div>
      <div className="flex items-center gap-2">
        {isOwner ? (
          <select aria-label={`Role for ${member.name}`} className="rounded-md border bg-background px-2 py-1" value={member.role} disabled={pending}
            onChange={(e) => start(async () => { const r = await changeRoleAction(member.userId, e.target.value); if (!r.ok) setError(r.error); })}>
            <option value="OWNER">Owner</option><option value="MANAGER">Manager</option><option value="WORKER">Worker</option>
          </select>
        ) : <span className="text-muted-foreground">{member.role}</span>}
        {isOwner && !isSelf && (
          <Button variant="ghost" size="sm" disabled={pending}
            onClick={() => { if (confirm(`Remove ${member.name}?`)) start(async () => { const r = await removeMemberAction(member.userId); if (!r.ok) setError(r.error); }); }}>
            Remove
          </Button>
        )}
      </div>
    </li>
  );
}
