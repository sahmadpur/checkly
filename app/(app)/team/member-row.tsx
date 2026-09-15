"use client";
import { useState, useTransition } from "react";
import { changeRoleAction, removeMemberAction } from "@/actions/member";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/form-error";
import { ListRow } from "@/components/ui/list";

const ROLE_LABEL: Record<string, string> = { OWNER: "Owner", MANAGER: "Manager", WORKER: "Worker" };

export function MemberRow({ member, isOwner, isSelf }: {
  member: { userId: string; name: string; email: string | null; phone: string | null; role: string; propertyCount: number };
  isOwner: boolean; isSelf: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <ListRow>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{member.name}{isSelf && <span className="font-normal text-muted-foreground"> (you)</span>}</div>
        <div className="truncate text-muted-foreground">{member.email ?? member.phone} · {member.propertyCount} propert{member.propertyCount === 1 ? "y" : "ies"}</div>
        <FormError message={error} />
      </div>
      <div className="flex items-center gap-2">
        {isOwner ? (
          <Select aria-label={`Role for ${member.name}`} className="w-32 [&>select]:h-9" value={member.role} disabled={pending}
            onChange={(e) => start(async () => { const r = await changeRoleAction(member.userId, e.target.value); if (!r.ok) setError(r.error); })}>
            <option value="OWNER">Owner</option><option value="MANAGER">Manager</option><option value="WORKER">Worker</option>
          </Select>
        ) : <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium">{ROLE_LABEL[member.role] ?? member.role}</span>}
        {isOwner && !isSelf && (
          <Button variant="ghost" size="sm" disabled={pending}
            onClick={() => { if (confirm(`Remove ${member.name} from the organization?`)) start(async () => { const r = await removeMemberAction(member.userId); if (!r.ok) setError(r.error); }); }}>
            Remove
          </Button>
        )}
      </div>
    </ListRow>
  );
}
