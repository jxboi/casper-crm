import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/shell";

export const metadata: Metadata = {
  title: "Casper CRM — Sales",
  description: "AI-native CRM demo · pipeline, assistant, and change-set approvals",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
