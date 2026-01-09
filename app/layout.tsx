import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Grafik Oddział",
  description: "Planowanie grafiku oddziału w Next.js",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
