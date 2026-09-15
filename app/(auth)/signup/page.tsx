import { AuthIntro } from "@/components/auth-intro";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <>
      <AuthIntro title="Create your organization">You become its owner and can invite managers and workers next.</AuthIntro>
      <SignupForm />
    </>
  );
}
