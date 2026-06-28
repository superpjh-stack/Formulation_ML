import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "고려솔더 제조 AI — 스마트공장",
  description: "성분분석 데이터 기반 배합비율 최적화 ML 시스템",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
