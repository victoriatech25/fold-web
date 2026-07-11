import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "절곡 단면 편집기",
  description: "알루미늄 절곡 단면과 전개 폭을 계산하는 웹 편집기",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
