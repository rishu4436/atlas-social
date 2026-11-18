import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = { title: "ATLAS Moderation Console", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans">
        <Providers><main className="mx-auto max-w-5xl px-4 py-8">{children}</main></Providers>
      </body>
    </html>
  );
}
