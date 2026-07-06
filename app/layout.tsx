import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ModeProvider } from "@/components/ModeProvider";
import Nav from "@/components/Nav";
import SessionWrapper from "@/components/SessionWrapper";
import { ToastProvider } from "@/components/ui/toast";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "FanMas",
  description: "FanMas — outbound sales command center for leads, outreach, and booking",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} min-h-screen`}>
        <SessionWrapper>
          <ModeProvider>
            <ToastProvider>
              <div className="flex min-h-screen">
                <Nav />
                <main className="flex-1 min-w-0 overflow-y-auto p-6 bg-[#070B12]">{children}</main>
              </div>
            </ToastProvider>
          </ModeProvider>
        </SessionWrapper>
      </body>
    </html>
  );
}
