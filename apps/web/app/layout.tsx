import type { Metadata, Viewport } from 'next';
import './globals.css';

const title = 'SolShield — Pre-signature transaction firewall for Solana';
const description =
  'Decode, simulate, and classify Solana transactions before the user signs. Open-source alternative to Blockaid and Blowfish.';

export const metadata: Metadata = {
  metadataBase: new URL('https://solshield.dev'),
  title: {
    default: title,
    template: '%s · SolShield',
  },
  description,
  applicationName: 'SolShield',
  keywords: [
    'solana',
    'security',
    'firewall',
    'transaction',
    'drainers',
    'blockaid',
    'blowfish',
    'wallet-security',
    'open-source',
  ],
  authors: [{ name: '0xnullpavel', url: 'https://github.com/0xnullpavel' }],
  openGraph: {
    type: 'website',
    url: 'https://solshield.dev',
    siteName: 'SolShield',
    locale: 'en_US',
    title,
    description,
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'SolShield — Pre-signature transaction firewall for Solana',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@0xnullpavel',
    creator: '@0xnullpavel',
    title,
    description,
    images: ['/og.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/favicon.svg',
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0a0b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-mono">{children}</body>
    </html>
  );
}
