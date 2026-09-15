import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { AuthIntro } from "@/components/auth-intro";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const session = await auth();
  if (session?.user) redirect("/");
  const { next, reset } = await searchParams;
  return (
    <>
      <AuthIntro title="Sign in">Use the email or phone number on your account.</AuthIntro>
      <LoginForm next={next} notice={reset ? "Password updated. Sign in with your new password." : undefined} />
    </>
  );
}
