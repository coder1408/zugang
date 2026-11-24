import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zugang — Admission audit for public German master's programmes",
  description:
    "Deterministic ECTS conversion, Bavarian grade formula and non-overlapping credit audit against official German admission regulations. For Indian B.Tech./B.E. graduates. No commission.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
