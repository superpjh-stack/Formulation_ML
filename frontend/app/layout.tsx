import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Navbar } from "@/components/layout/Navbar";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Formulation ML — 배합비율 최적화",
  description: "성분분석 데이터 기반 배합비율 최적화 ML 시스템",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className={inter.className}>
        <Navbar />
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
