import type { Metadata, Viewport } from "next";
import { Fraunces, Hanken_Grotesk, Noto_Sans_Devanagari, Noto_Serif_Devanagari } from "next/font/google";
import "./globals.css";

const display = Fraunces({ subsets: ["latin"], variable: "--font-display", axes: ["opsz", "SOFT"] });
const body = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-body" });
const deva = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--font-deva", weight: ["400", "500", "600"] });
const devaSerif = Noto_Serif_Devanagari({ subsets: ["devanagari"], variable: "--font-deva-serif", weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "YAAR",
  description: "A voice-first AI friend that speaks your language, built on Gnani Prisma and Timbre.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d0a0c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${deva.variable} ${devaSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
