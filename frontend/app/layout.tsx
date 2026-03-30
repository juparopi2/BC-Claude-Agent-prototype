import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { AuthProvider, ThemeProvider, ServiceWorkerProvider } from "@/components/providers";
import { GlobalBanners } from "@/components/layout";
import { OnboardingProvider } from "@/src/domains/onboarding/components/OnboardingProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MyWorkMate - Your AI Business Assistant",
  description: "Connect and automate your business operations across multiple platforms including Business Central, SharePoint, OneDrive, and more",
  icons: {
    icon: [
      {
        url: '/branding/favicon-light.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/branding/favicon-dark.png',
        media: '(prefers-color-scheme: dark)',
      },
    ],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const messages = await getMessages();

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>
            <AuthProvider>
              <ServiceWorkerProvider />
              <GlobalBanners />
              <OnboardingProvider />
              {children}
            </AuthProvider>
            <Toaster position="bottom-right" />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
