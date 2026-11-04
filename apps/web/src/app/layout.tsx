import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
    title: "Prompt Lab",
    description: "Compare prompts and models on a hand-labelled test set, with real scores",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className={inter.variable}>
            <body>
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
