import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 测款与上架工作台",
  description:
    "A lightweight AI workbench for tool-product positioning, launch metadata, and testing plans."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
