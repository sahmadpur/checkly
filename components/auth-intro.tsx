/** Title block for the signed-out screens. */
export function AuthIntro({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold text-balance">{title}</h1>
      {children && <p className="text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}
