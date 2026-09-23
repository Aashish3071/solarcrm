import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SolarCRM",
  description: "Solar operations and project lifecycle",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
