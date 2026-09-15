import { AuthVisual } from "@/components/auth-visual";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="lg:min-h-dvh"><AuthVisual /></div>
      <div className="flex flex-col px-4 py-8 sm:justify-center sm:px-8 sm:py-12">
        <div className="mx-auto w-full max-w-sm space-y-6">{children}</div>
      </div>
    </main>
  );
}
