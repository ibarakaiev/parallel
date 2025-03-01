import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Parallel - Anthropic Chat Interface",
  description: "An Anthropic-inspired chat interface",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="stylesheet" href="https://use.typekit.net/pxe5yzd.css" />
      </head>
      <body className="font-serif antialiased h-full bg-accent-50">
        {children}
      </body>
    </html>
  );
}

