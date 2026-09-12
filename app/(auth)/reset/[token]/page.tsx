import { ResetForm } from "./reset-form";
export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ResetForm token={token} />;
}
