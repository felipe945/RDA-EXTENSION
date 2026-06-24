import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ModeProvider } from "@/components/ModeProvider";
import Nav from "@/components/Nav";
import SessionWrapper from "@/components/SessionWrapper";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Unified Sales Ops",
  description: "FanBasis + Servedia command center",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-gray-950 text-gray-100 min-h-screen`}>
        <SessionWrapper>
          <ModeProvider>
            <Nav />
            <main className="p-6">{children}</main>
          </ModeProvider>
        </SessionWrapper>
      </body>
    </html>
  );
}
