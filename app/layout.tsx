import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

import {
  SessionSidebar,
  SidebarProvider,
} from "@/components/features/sessions/session-sidebar";
import { SessionStoreProvider } from "@/components/features/sessions/session-store";
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
      suppressHydrationWarning
      className={cn("dark", "h-full", "antialiased", geistSans.variable, geistMono.variable, "font-sans", inter.variable)}
    >
      <body className="h-full w-full overflow-hidden flex flex-col font-sans">
        <SessionStoreProvider>
          <SidebarProvider>
            <div className="flex h-dvh min-h-0 w-full overflow-hidden">
              <SessionSidebar />
              <main className="flex-1 flex flex-col min-w-0 max-w-full overflow-hidden">
                {children}
              </main>
            </div>
          </SidebarProvider>
        </SessionStoreProvider>
      </body>
    </html>
  );
}
