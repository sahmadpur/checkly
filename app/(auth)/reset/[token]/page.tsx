import { getPasswordReset } from "@/lib/services/auth";
import { ResetForm } from "./reset-form";
export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = await getPasswordReset(token);
  if (!valid) return <p className="p-6 text-sm">This reset link is invalid or has expired.</p>;
  return <ResetForm token={token} />;
}
