import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Global overlay components
import Cursor from "@/components/Cursor";
import EyeTracker from "@/components/EyeTracker";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Eye-Control App | Touchless Navigation",
  description:
    "An eye-tracking based touchless interface that allows users to control apps using eye movement and blinks.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased overflow-hidden`}
      >
        {/*
          GLOBAL EYE CONTROL OVERLAY
          - fixed: stays on all routes (/ , /youtube , /google , etc.)
          - pointer-events-none: visuals never block clicks
          - very high z-index: always above UI
        */}
        <div className="fixed inset-0 z-[9999] pointer-events-none">
          <Cursor />
          <EyeTracker />
        </div>

        {/* App pages */}
        {children}
      </body>
    </html>
  );
}
