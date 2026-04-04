import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import { COMPANY } from "@/lib/company";

export const metadata: Metadata = {
  title: `${COMPANY.name} | Project Management`,
  description: `${COMPANY.name} project management system`,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
