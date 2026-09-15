import type { Metadata, Viewport } from "next";
import { Inter, Manrope } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import "./globals.css";

const body = Inter({ subsets: ["latin", "latin-ext", "cyrillic"], variable: "--font-body", display: "swap" });
const display = Manrope({ subsets: ["latin", "latin-ext", "cyrillic"], variable: "--font-display", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: { default: "Checkly", template: "%s · Checkly" },
    description: t("tagline"),
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, statusBarStyle: "default", title: "Checkly" },
  };
}

export const viewport: Viewport = { themeColor: "#1e6b5a", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={await getLocale()} className={`${body.variable} ${display.variable}`}>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
