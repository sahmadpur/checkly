import { AuthIntro } from "@/components/auth-intro";
import { ForgotForm } from "./forgot-form";

export default function ForgotPage() {
  return (
    <>
      <AuthIntro title="Reset your password">We&apos;ll email you a link if the account has an email address.</AuthIntro>
      <ForgotForm />
    </>
  );
}
