import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

import { SessionSidebar } from "@/components/chat/session-sidebar";
import { SessionStoreProvider } from "@/components/chat/session-store";
import { cn } from "@/lib/utils";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Anton",
  description: "A mini AI coding agent harness",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn("dark", "h-full", "antialiased", geistSans.variable, geistMono.variable, "font-sans", inter.variable)}
    >
      <body className="min-h-full flex flex-col font-sans">
        <SessionStoreProvider>
          <div className="flex-1 flex min-h-0">
            <SessionSidebar />
            <main className="flex-1 flex flex-col min-w-0">{children}</main>
          </div>
        </SessionStoreProvider>
      </body>
    </html>
  );
}
