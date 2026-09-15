import { auth } from "@/lib/auth/config";
import { getInvite } from "@/lib/services/invite";
import { db } from "@/lib/db";
import { AuthIntro } from "@/components/auth-intro";
import { AcceptForm } from "./accept-form";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await getInvite(token);
  if (!invite) return <AuthIntro title="This invitation has expired">Ask the person who invited you to send a new one.</AuthIntro>;

  const session = await auth();
  let mode: "new" | "signed-in" | "needs-login" = "new";
  if (invite.existingUser) {
    if (!session?.user) mode = "needs-login";
    else {
      const me = await db.user.findUnique({ where: { id: session.user.id }, select: { email: true } });
      mode = me?.email === invite.email ? "signed-in" : "needs-login";
    }
  }
  return (
    <>
      <AuthIntro title={`Join ${invite.orgName}`}>You&apos;re invited as {invite.role.toLowerCase()} with {invite.email}.</AuthIntro>
      <AcceptForm token={token} orgName={invite.orgName} email={invite.email} role={invite.role} mode={mode} />
    </>
  );
}
