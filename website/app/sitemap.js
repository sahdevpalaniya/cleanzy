import { SITE, GUIDES } from './site';

export const dynamic = 'force-static';

export default function sitemap() {
  return ['/', '/windows/', '/mac/', '/linux/', '/guides/', ...GUIDES.map(g => g[0]), '/privacy/']
    .map(p => ({ url: SITE + p, lastModified: '2026-10-24' }));
}
