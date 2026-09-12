import { logoutAction } from "@/actions/auth";
export default function NoOrgPage() {
  return (
    <main className="mx-auto max-w-sm p-8 text-center text-sm">
      <p>You are not a member of any organization. Ask a manager for an invitation.</p>
      <form action={logoutAction} className="mt-4"><button className="underline">Sign out</button></form>
    </main>
  );
}
