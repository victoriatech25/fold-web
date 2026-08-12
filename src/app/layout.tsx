import type { Metadata } from "next";
import { CommonPopupProvider } from "@/components/ui/common-popup";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "FOLD WEB",
    template: "%s | FOLD WEB",
  },
  description: "절곡 설계와 제작 업무를 연결하는 웹서비스",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <CommonPopupProvider>{children}</CommonPopupProvider>
      </body>
    </html>
  );
}
