import { logoutAction } from "@/actions/auth";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";

export default function NoOrgPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <Wordmark className="text-2xl" />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">You&apos;re not in an organization yet</h1>
        <p className="text-sm text-muted-foreground">Ask a manager to send you an invitation, then open the link from that email.</p>
      </div>
      <form action={logoutAction}><Button variant="outline" type="submit">Sign out</Button></form>
    </main>
  );
}
