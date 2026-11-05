import './globals.css';
import { SITE, Ld } from './site';

export const metadata = {
  metadataBase: new URL(SITE),
  title: 'Cleanzy – Free Disk Cleaner for Windows, Mac & Linux',
  description: 'Free up disk space safely. Clear caches, developer junk, large files and app leftovers. Every item labelled Safe or Check First. No account, no telemetry.',
  icons: { icon: '/img/icon-64.png' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Ld data={{ '@context': 'https://schema.org', '@type': 'Organization', name: 'Cleanzy', url: SITE }} />
      </body>
    </html>
  );
}
