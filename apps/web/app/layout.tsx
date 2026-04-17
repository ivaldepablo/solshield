import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'solshield',
  description: 'open-source transaction firewall for solana',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-mono">{children}</body>
    </html>
  );
}
