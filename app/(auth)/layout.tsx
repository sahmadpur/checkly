import { Wordmark } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col px-4 py-8 sm:justify-center sm:py-12">
      <div className="mx-auto w-full max-w-sm space-y-6">
        <Wordmark className="text-2xl" />
        {children}
      </div>
    </main>
  );
}
