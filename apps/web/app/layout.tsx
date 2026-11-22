import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell";

export const metadata: Metadata = {
  metadataBase: new URL("https://atlascalls.xyz"),
  title: { default: "ATLAS Social", template: "%s · ATLAS" },
  description: "Agent ID-native social research network on BNB Smart Chain. Verifiable theses, transparent performance, AI research that never trades for you.",
};
export const viewport: Viewport = { themeColor: "#080D14", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
