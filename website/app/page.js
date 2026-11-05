import { HeroDownload, DownloadCards, InstallTabs } from './ui';
import { VERSION, GUIDES, Shell, Faq, meta, appLd, faqLd } from './site';

export const metadata = meta('/', 'Cleanzy – Free Disk Cleaner for Windows, Mac & Linux',
  'Free up disk space safely. Clear caches, developer junk, large files and app leftovers. Every item labelled Safe or Check First. No account, no telemetry.');

const I = {
  caches: <><ellipse cx="12" cy="5.5" rx="8" ry="2.5" /><path d="M4 5.5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6M4 11.5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" /></>,
  dev: <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />,
  files: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>,
  apps: <><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><path d="M17.25 14v6.5M14 17.25h6.5" /></>,
  map: <><circle cx="12" cy="12" r="9" /><path d="M12 3v9l6.4 6.4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  shield: <path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6z" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
};
const Ic = ({ n }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{I[n]}</svg>;

const OS = {
  win: { req: 'Windows 10 and 11 · 64-bit', icon: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 5.5 10.5 4.5v7H3zM11.5 4.4 21 3v8.5h-9.5zM3 12.5h7.5v7L3 18.5zM11.5 12.5H21V21l-9.5-1.4z" /></svg> },
  mac: { req: 'macOS 11 or later', icon: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.5-1-2.5-3.9zM14 5.5c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4z" /></svg> },
  linux: { req: '64-bit · .deb for Debian and Ubuntu, .tar.gz for other distributions', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 2.5c-2.2 0-3.3 2-3.3 4.5 0 1.6-.6 2.6-1.6 4.1C5.6 13.3 4.5 15.7 5.6 18c-1 .3-1.7 1-1.4 1.8.4 1 2.2.8 3.5 1.4 1.4.6 2.6.3 3.2-.5h2.2c.6.8 1.8 1.1 3.2.5 1.3-.6 3.1-.4 3.5-1.4.3-.8-.4-1.5-1.4-1.8 1.1-2.3 0-4.7-1.5-6.9-1-1.5-1.6-2.5-1.6-4.1 0-2.5-1.1-4.5-3.3-4.5z" /></svg> },
};

const STEPS = {
  win: <>
    <li>Download <code>Cleanzy-{VERSION}-win-x64.zip</code> (or <code>win-arm64</code> on an Arm PC) and open it.</li>
    <li>Drag the <b>Cleanzy</b> folder somewhere permanent, like your Documents.</li>
    <li>Open the folder and double-click <b>Cleanzy.exe</b>.</li>
    <li>If you see “Windows protected your PC”, click <b>More info</b> → <b>Run anyway</b>. It shows because the app isn’t code-signed yet.</li>
    <li>Optional: right-click <b>Cleanzy.exe</b> → <b>Pin to Start</b>.</li>
  </>,
  mac: <>
    <li>Not sure which Mac you have? Open  → <b>About This Mac</b>. “Apple M1–M4” means Apple Silicon.</li>
    <li>Download the <code>.dmg</code> for your Mac and double-click it.</li>
    <li>In the window that opens, drag <b>Cleanzy</b> onto the <b>Applications</b> folder.</li>
    <li>The app isn’t notarised yet, so the first time, open <b>Terminal</b> and run:<pre>xattr -dr com.apple.quarantine /Applications/Cleanzy.app</pre></li>
    <li>Open Cleanzy. To see every folder, turn it on in System Settings → Privacy &amp; Security → <b>Full Disk Access</b>.</li>
  </>,
  linux: <>
    <li><b>Debian, Ubuntu and derivatives:</b> download <code>cleanzy_{VERSION}_amd64.deb</code> (<code>arm64</code> on ARM machines).</li>
    <li>Double-click it and choose <b>Install</b>, or run:<pre>sudo apt install ./cleanzy_{VERSION}_amd64.deb</pre></li>
    <li><b>Any other distribution:</b> download <code>Cleanzy-{VERSION}-linux-x64.tar.gz</code> (or <code>linux-arm64</code>) and extract it:<pre>tar xzf Cleanzy-{VERSION}-linux-x64.tar.gz</pre>Then open the extracted folder and run <code>./Cleanzy</code>.</li>
    <li>With the .deb, open <b>Cleanzy</b> from your app menu.</li>
    <li>To remove it later: <code>sudo apt remove cleanzy</code>, or delete the extracted folder.</li>
  </>,
};

const FAQ = [
  ['Is it really free?', 'Yes. No trial, no subscription, no paid tier and no ads.'],
  ['Can it delete something important?', 'Cleanzy only offers folders it recognises, like caches and build output. Your own files go only when you pick them. Everything goes to the Trash, where you can put it back, unless you choose Delete Permanently. A few system clean-ups run as a command and are permanent; Cleanzy tells you before they run.'],
  ['Does it collect any data?', 'No. No account, no analytics, no crash reporting. Settings and history stay on your computer.'],
  ['Why does it sometimes ask for my password?', 'A few system items, like the package cache or old system logs, belong to the administrator. Cleanzy asks only when you pick one of those, and never stores the password.'],
  ['Why didn’t my free space go up?', 'Files in the Trash still take space until you empty it. Use Empty Trash in Cleanzy, or choose Delete Permanently.'],
  ['How do I uninstall Cleanzy?', 'Windows: delete the Cleanzy folder. macOS: drag Cleanzy.app to the Trash. Linux: sudo apt remove cleanzy, or delete the extracted folder for the .tar.gz build.'],
];


const FEATURES = [
  ['caches', 'Temporary Files', 'App caches, logs, crash reports, thumbnails and old installers. Rebuilt on their own.'],
  ['dev', 'Developer Junk', <>Caches from 70+ package managers, build tools and IDEs, old <code>node_modules</code> and build folders, and orphaned git worktrees. Projects you’re still working on are skipped.</>],
  ['files', 'Large Files', 'Big downloads, videos, disk images and exact duplicates, by size and age.'],
  ['apps', 'Remove Apps', 'Uninstall an app with its settings and caches, and sweep up leftovers of apps already gone.'],
  ['map', 'Storage Map', 'Every folder by size, as a list or a colour map. Spot what’s taking room in seconds.'],
  ['clock', 'Scheduled cleaning', 'Clear safe items weekly or monthly from the tray. Off until you turn it on.'],
];
const PROMISES = [
  ['trash', 'Trash first', 'Recoverable unless you pick Delete Permanently.'],
  ['lock', 'Hands off your stuff', 'Documents, photos, keys, passwords and mail are never offered.'],
  ['eye', 'No tracking', 'No account, no analytics. Nothing leaves your computer.'],
  ['shield', 'You confirm', 'Nothing is removed until you see the list and say yes.'],
];

export default function Home() {
  return (
    <Shell ld={[appLd('Windows, macOS, Linux'), faqLd(FAQ)]}>
      <header id="top" className="hero wrap">
        <h1>Free disk cleaner for Windows, macOS and Linux</h1>
        <p className="lead">Cleanzy finds the gigabytes hiding in caches, build folders, old downloads and forgotten apps, and clears them without touching anything you care about.</p>
        <HeroDownload icons={{ win: OS.win.icon, mac: OS.mac.icon, linux: OS.linux.icon }} />
        <figure className="shot">
          <picture>
            <source srcSet="/img/dark-overview.webp" media="(prefers-color-scheme: dark)" />
            <img src="/img/light-overview.webp" alt="The Cleanzy Home screen after a scan, listing categories with their sizes" />
          </picture>
        </figure>
      </header>

      <section id="features" className="band">
        <div className="wrap">
          <h2>What Cleanzy cleans</h2>
          <p className="sub">Everything that quietly fills your disk.</p>
          <div className="grid3">
            {FEATURES.map(([n, h, p]) => <div key={h} className="feat"><Ic n={n} /><h3>{h}</h3><p>{p}</p></div>)}
          </div>
        </div>
      </section>

      <section id="video" className="wrap">
        <h2>See it in action</h2>
        <p className="sub">From scan to clean in under a minute.</p>
        <div className="frame">
          <video src="/video/cleanzy-demo.mp4" poster="/video/cleanzy-demo-poster.jpg" autoPlay muted playsInline loop controls preload="auto" aria-label="Cleanzy demo: scanning, reviewing and cleaning safe items" />
        </div>
      </section>

      <section id="safety" className="band">
        <div className="wrap split">
          <div>
            <h2>Safe or Check First: every item labelled</h2>
            <p className="sub">Every item is labelled before anything is cleaned. One click only ever takes the safe ones.</p>
            <dl className="labels">
              <div><dt><span className="badge safe">Safe to Clean</span></dt><dd>Rebuilt automatically. You won’t notice they’re gone.</dd></div>
              <div><dt><span className="badge check">Check First</span></dt><dd>Nothing is lost, but it costs a re-download or a slower next build.</dd></div>
            </dl>
          </div>
          <ul className="promises">
            {PROMISES.map(([n, h, p]) => <li key={h}><Ic n={n} /><div><h3>{h}</h3><p>{p}</p></div></li>)}
          </ul>
        </div>
      </section>

      <section className="wrap">
        <h2>How to free up disk space in three steps</h2>
        <ol className="steps">
          {[['Scan', 'Open Cleanzy and press Scan.'], ['Review', 'See what each category holds and what’s safe.'], ['Clean', 'Move to Trash or Delete Permanently. Your call.']]
            .map(([h, p], i) => <li key={h}><span className="n">{i + 1}</span><h3>{h}</h3><p>{p}</p></li>)}
        </ol>
      </section>

      <section className="wrap">
        <h2>Cleanzy on your system</h2>
        <p className="sub">What it cleans on each platform, and guides for doing it by hand.</p>
        <div className="grid3">
          <div className="feat"><h3><a href="/windows/">Cleanzy for Windows</a></h3><p>App caches in AppData, temporary files, crash dumps and developer caches.</p></div>
          <div className="feat"><h3><a href="/mac/">Cleanzy for Mac</a></h3><p>Library caches, Xcode junk, and leftovers of apps you already deleted.</p></div>
          <div className="feat"><h3><a href="/linux/">Cleanzy for Linux</a></h3><p>.deb and .tar.gz builds, a Storage Map, apt, journal and snap clean-up.</p></div>
          {GUIDES.map(([h, t, p]) => <div key={h} className="feat"><h3><a href={h}>{t}</a></h3><p>{p}</p></div>)}
        </div>
      </section>

      <section id="download" className="band">
        <div className="wrap">
          <h2>Download Cleanzy for free</h2>
          <p className="sub">Free for Windows, macOS and Linux. Version {VERSION}.</p>
          <DownloadCards meta={OS} />
        </div>
      </section>

      <section id="install" className="wrap narrow">
        <h2>Install Cleanzy</h2>
        <p className="sub">Up and running in a minute.</p>
        <InstallTabs steps={STEPS} />
      </section>

      <section id="faq" className="wrap narrow">
        <h2>Frequently asked questions</h2>
        <Faq items={FAQ} />
        <p className="sub">More detail: <a href="/privacy/">privacy</a> and <a href="/guides/what-is-safe-to-delete/">what is safe to delete</a>.</p>
      </section>
    </Shell>
  );
}
