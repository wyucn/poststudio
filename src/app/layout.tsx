import type { Metadata } from "next";
import "./globals.css";
// 拉丁 / 数字：Space Grotesk（科技运动感）· 仅 latin 子集
import "@fontsource/space-grotesk/latin-400.css";
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-600.css";
import "@fontsource/space-grotesk/latin-700.css";
// 等宽 / 代码感：Space Mono · 仅 latin 子集
import "@fontsource/space-mono/latin-400.css";
import "@fontsource/space-mono/latin-700.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Haitun Post Studio · AIGC 协同创作平台",
  description: "面向创意团队的图像、视频、音乐与配音 AIGC 协同创作工作站",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
