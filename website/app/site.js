// Shared server parts: site URL, builds, metadata, JSON-LD, nav and footer.

// TODO: set NEXT_PUBLIC_SITE_URL to the real domain at build time; example.com is only a placeholder.
export const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://example.com').replace(/\/$/, '');

export const VERSION = '1.3.0';
const D = `https://github.com/sahdevpalaniya/cleanzy/releases/download/v${VERSION}/`;
// Every build, one row per package format, one link per CPU. The first link of the first row is the default.
export const BUILDS = {
  win: [{ fmt: '.zip', links: [['x64', `${D}Cleanzy-${VERSION}-win-x64.zip`], ['Arm64', `${D}Cleanzy-${VERSION}-win-arm64.zip`]] }],
  mac: [
    { fmt: '.dmg', note: 'installer', links: [['Apple Silicon', `${D}Cleanzy-${VERSION}-mac-arm64.dmg`], ['Intel', `${D}Cleanzy-${VERSION}-mac-x64.dmg`]] },
  ],
  linux: [
    { fmt: '.deb', note: 'Debian, Ubuntu', links: [['x64', `${D}cleanzy_${VERSION}_amd64.deb`], ['Arm64', `${D}cleanzy_${VERSION}_arm64.deb`]] },
    { fmt: '.tar.gz', note: 'any distro', links: [['x64', `${D}Cleanzy-${VERSION}-linux-x64.tar.gz`], ['Arm64', `${D}Cleanzy-${VERSION}-linux-arm64.tar.gz`]] },
  ],
};
export const NAME = { win: 'Windows', mac: 'macOS', linux: 'Linux' };

export const GUIDES = [
  ['/guides/what-is-safe-to-delete/', 'Is it safe to delete cache folders?', 'Folder-by-folder tables for macOS, Windows and Linux, with the same Safe and Check First labels Cleanzy uses.'],
  ['/guides/developer-disk-cleanup/', 'How to clear developer caches', 'Manual commands for node_modules, npm, pip, Gradle, Maven, Cargo, Xcode, Docker and git worktrees.'],
  ['/guides/free-up-space-ubuntu/', 'How to free up disk space on Ubuntu', 'df and du, apt, the system journal, old snap revisions, old kernels, ~/.cache and the Trash.'],
];

const OG = { url: '/og.png', width: 1200, height: 630, alt: 'Cleanzy: free up disk space, safely' };
// Next replaces openGraph/twitter wholesale per page, so every page gets the full set.
export const meta = (path, title, description) => ({
  title, description, alternates: { canonical: path },
  openGraph: { title, description, url: path, siteName: 'Cleanzy', type: 'website', images: [OG] },
  twitter: { card: 'summary_large_image', title, description, images: [OG.url] },
});

export const Ld = ({ data }) => (
  <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />
);
export const appLd = (os, file) => ({
  '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Cleanzy', operatingSystem: os,
  applicationCategory: 'UtilitiesApplication', softwareVersion: VERSION, downloadUrl: file ? SITE + file : `${SITE}/#download`,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, publisher: { '@type': 'Organization', name: 'Cleanzy' },
});
export const faqLd = faq => ({
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
});
const crumbLd = crumbs => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: crumbs.map(([href, name], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE + href })),
});

export const Faq = ({ items }) => (
  <div className="faq">{items.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
);

const NAV = [['/#features', 'Features'], ['/windows/', 'Windows'], ['/mac/', 'macOS'], ['/linux/', 'Linux'], ['/guides/', 'Guides'], ['/#faq', 'FAQ']];
const FOOT = [['/', 'Home'], ['/windows/', 'Windows'], ['/mac/', 'macOS'], ['/linux/', 'Linux'], ['/guides/', 'Guides'],
  ...GUIDES.map(([h, t]) => [h, t.replace(/^How to |\?$/g, '').replace(/^./, c => c.toUpperCase())]), ['/privacy/', 'Privacy'], ['/#download', 'Download']];
const Brand = () => <a className="brand" href="/"><img src="/img/icon-64.png" alt="" width="24" height="24" />Cleanzy</a>;

export function Shell({ children, ld = [] }) {
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <nav className="nav"><div className="wrap">
        <Brand />
        <ul>{NAV.map(([h, t]) => <li key={h}><a href={h}>{t}</a></li>)}</ul>
        <a className="btn primary sm" href="/#download">Download</a>
      </div></nav>
      <main id="main">{children}</main>
      <footer className="foot"><div className="wrap">
        <Brand />
        <span className="sp" />
        {FOOT.map(([h, t]) => <a key={h} href={h}>{t}</a>)}
        <span className="muted">© 2026 Cleanzy</span>
      </div></footer>
      {ld.map((d, i) => <Ld key={i} data={d} />)}
    </>
  );
}

// A guide or reference page: breadcrumbs, one H1, last-updated line, then the body.
export function Doc({ crumbs, title, lead, updated = '24 Oct 2026', children, ld = [] }) {
  const all = [['/', 'Home'], ...crumbs];
  return (
    <Shell ld={[crumbLd(all), ...ld]}>
      <article className="wrap narrow doc">
        <nav className="crumbs" aria-label="Breadcrumb">
          {all.map(([h, t], i) => i < all.length - 1 ? <span key={h}><a href={h}>{t}</a> / </span> : <span key={h} aria-current="page">{t}</span>)}
        </nav>
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
        {updated && <p className="updated">Last updated: {updated}</p>}
        {children}
      </article>
    </Shell>
  );
}

// Server-rendered download links for one OS (no detection needed).
export function Downloads({ os }) {
  return (
    <div className="hero-cta">
      <div className="actions">
        <a className="btn primary big" href={BUILDS[os][0].links[0][1]} download>Download for {NAME[os]}{os === 'linux' ? ' (.deb)' : ''}</a>
        <a className="more" href="/#download">All downloads</a>
      </div>
      <p className="meta">Free · Version {VERSION} · {BUILDS[os].flatMap(r => r.links.map(([a, h]) => <span key={h}> <a href={h} download>{r.fmt} {a}</a></span>))}</p>
    </div>
  );
}
