"use client";
import { useState, useTransition } from "react";
import { revokeInviteAction } from "@/actions/invite";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";

export function InviteRow({ invite }: { invite: { id: string; email: string; role: string; expiresAt: Date } }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <li className="flex items-center justify-between gap-2 p-3 text-sm">
      <div>
        <span>{invite.email} <span className="text-muted-foreground">· {invite.role.toLowerCase()} · expires {invite.expiresAt.toLocaleDateString()}</span></span>
        <FormError message={error} />
      </div>
      <Button variant="ghost" size="sm" disabled={pending}
        onClick={() => start(async () => { const r = await revokeInviteAction(invite.id); if (!r.ok) setError(r.error); })}>
        Revoke
      </Button>
    </li>
  );
}
