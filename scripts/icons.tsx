// Renders the app icon (app/icon.svg) to the PNG sizes the manifest, iOS and push notifications need.
// Run after changing the mark: pnpm icons
import { writeFile } from "node:fs/promises";
import { ImageResponse } from "next/og";

function Mark({ size, pad }: { size: number; pad: number }) {
  const inner = size - pad * 2;
  return (
    <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: pad ? "#1e6b5a" : "transparent" }}>
      <svg width={inner} height={inner} viewBox="0 0 64 64">
        <rect width="64" height="64" rx={pad ? 0 : 16} fill="#1e6b5a" />
        <path d="M17 34l10 10 20-22" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

const targets: [string, number, number][] = [
  ["app/apple-icon.png", 180, 0],
  ["public/icons/icon-192.png", 192, 0],
  ["public/icons/icon-512.png", 512, 0],
  ["public/icons/icon-512-maskable.png", 512, 80],
];

async function main() {
  for (const [file, size, pad] of targets) {
    const res = new ImageResponse(<Mark size={size} pad={pad} />, { width: size, height: size });
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    console.log(file);
  }
}
main();
