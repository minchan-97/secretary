import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_KR, Gowun_Batang } from 'next/font/google';
import './globals.css';

const sans = IBM_Plex_Sans_KR({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  variable: '--nf-sans',
  display: 'swap',
});

const serif = Gowun_Batang({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--nf-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: '업무 비서',
  description: '업무 비서에게 일을 맡기고 결재하는 곳',
  appleWebApp: { capable: true, title: '비서', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/icon-192.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#E8ECF0' },
    { media: '(prefers-color-scheme: dark)', color: '#12161D' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <div className="frame">{children}</div>
      </body>
    </html>
  );
}
