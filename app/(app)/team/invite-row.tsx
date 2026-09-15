"use client";
import { useState, useTransition } from "react";
import { revokeInviteAction } from "@/actions/invite";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { ListRow } from "@/components/ui/list";

export function InviteRow({ invite }: { invite: { id: string; email: string; role: string; expiresAt: Date } }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <ListRow>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{invite.email}</div>
        <div className="text-muted-foreground">{invite.role[0] + invite.role.slice(1).toLowerCase()} · expires {invite.expiresAt.toLocaleDateString()}</div>
        <FormError message={error} />
      </div>
      <Button variant="ghost" size="sm" disabled={pending}
        onClick={() => start(async () => { const r = await revokeInviteAction(invite.id); if (!r.ok) setError(r.error); })}>
        Revoke
      </Button>
    </ListRow>
  );
}
