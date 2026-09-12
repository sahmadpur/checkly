import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const session = await auth();
  if (session?.user) redirect("/");
  const { next, reset } = await searchParams;
  return <LoginForm next={next} notice={reset ? "Password updated. Sign in with your new password." : undefined} />;
}
