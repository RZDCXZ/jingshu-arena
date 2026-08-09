import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/noto-sans-sc";

import "./styles.css";

export const metadata: Metadata = {
  description: "电竞场馆预约与运营协同演示",
  title: "竞枢 · Jingshu Arena",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
