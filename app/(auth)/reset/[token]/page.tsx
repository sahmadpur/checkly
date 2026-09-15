import Link from "next/link";
import { getPasswordReset } from "@/lib/services/auth";
import { AuthIntro } from "@/components/auth-intro";
import { Button } from "@/components/ui/button";
import { ResetForm } from "./reset-form";

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = await getPasswordReset(token);
  if (!valid) {
    return (
      <>
        <AuthIntro title="This reset link has expired">Request a new one and use it within the hour.</AuthIntro>
        <Button className="w-full" render={<Link href="/forgot" />}>Request a new link</Button>
      </>
    );
  }
  return (
    <>
      <AuthIntro title="Choose a new password">At least 8 characters.</AuthIntro>
      <ResetForm token={token} />
    </>
  );
}
