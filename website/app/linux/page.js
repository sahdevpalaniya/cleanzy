import { Shell, Downloads, Faq, meta, appLd, faqLd, VERSION, BUILDS, SITE } from '../site';

export const metadata = meta('/linux/', 'Free Disk Cleaner & Disk Usage Analyzer for Linux',
  'Free Linux disk cleaner with a Storage Map treemap. Clears caches, apt packages, old journal logs, disabled snap revisions and developer junk. .deb and .tar.gz.');

const FAQ = [
  ['Which distributions does Cleanzy run on?', 'The .deb installs on Debian, Ubuntu and their derivatives. The .tar.gz build runs on other 64-bit distributions: extract it and run ./Cleanzy. Both come for x64 and Arm64.'],
  ['Why does Cleanzy ask for my password?', 'Downloaded apt packages, the system journal and snap revisions belong to root. Cleanzy asks only when you select one of those items, runs the matching command (apt-get clean, journalctl --vacuum-size=100M or snap remove --revision), and does not store the password.'],
  ['Does Cleanzy remove old kernels?', 'No. Cleanzy does not offer kernels. On Ubuntu, sudo apt autoremove handles old kernels; see the Ubuntu guide for how to check first.'],
  ['Where do cleaned files go?', 'To your Trash (~/.local/share/Trash), unless you choose Delete Permanently. The apt, journal and snap clean-ups run as commands and are permanent; they are labelled Check First and never selected for you.'],
  ['Why did my free space not go up after deleting a file?', 'Either the file is still in the Trash, or a running program still has it open. The Storage Map shows space held by deleted files and can release it without restarting the program when it is a log file.'],
  ['How do I uninstall Cleanzy?', 'sudo apt remove cleanzy for the .deb, or delete the extracted folder for the .tar.gz build.'],
];

export default function Linux() {
  return (
    <Shell ld={[appLd('Linux', BUILDS.linux[0].links[0][1]), faqLd(FAQ)]}>
      <header className="hero os wrap">
        <h1>Free disk cleaner and disk usage analyzer for Linux</h1>
        <p className="lead">See what fills your disk on a treemap, then clear caches, downloaded packages, old logs and developer junk. Every item is labelled before anything is removed.</p>
        <Downloads os="linux" />
      </header>

      <article className="wrap narrow doc">
        <h2>Install on Linux</h2>
        <h3>Debian, Ubuntu and derivatives (apt)</h3>
        <p>Add the Cleanzy repository once, then install. <code>sudo apt upgrade</code> keeps it up to date.</p>
        <pre>{`curl -fsSL ${SITE}/install.sh | sudo bash`}</pre>
        <p>After that, <code>sudo apt install cleanzy</code> works like any other package.</p>
        <h3>Or install the .deb directly</h3>
        <p>Download <code>cleanzy_{VERSION}_amd64.deb</code> (or <code>arm64</code>), double-click it and choose Install, or run:</p>
        <pre>sudo apt install ./cleanzy_{VERSION}_amd64.deb</pre>
        <p>Then open Cleanzy from your app menu.</p>
        <h3>Any other distribution (.tar.gz)</h3>
        <pre>tar xzf Cleanzy-{VERSION}-linux-x64.tar.gz</pre>
        <p>Open the extracted folder and run <code>./Cleanzy</code>. To remove it, delete the folder.</p>

        <h2>Storage Map: a disk usage analyzer with a treemap</h2>
        <p>The Storage Map shows every folder by size, as a list or as a colour treemap, so the biggest folders stand out at once. On Linux it reads sizes with <code>du</code>, staying on one file system, so other mounted drives are not counted in.</p>
        <p>It also lists <b>space held by deleted files</b>: files you deleted that a running program still has open. Linux keeps their blocks until the program closes them, which is why free space sometimes does not go up until you reboot. When the file is a log the program is writing to, Cleanzy can empty it and free the space without restarting anything. Other files are listed but never emptied for you.</p>

        <h2>What Cleanzy cleans on Linux</h2>
        <ul>
          <li><b>App caches</b> in <code>~/.cache</code> (or your <code>XDG_CACHE_HOME</code>), including thumbnails, the font cache and graphics shader caches, plus the caches of Snap apps (<code>~/snap/&lt;app&gt;/common/.cache</code>) and Flatpak apps (<code>~/.var/app/&lt;id&gt;/cache</code>).</li>
          <li><b>Browser and Electron app caches</b> inside <code>~/.config</code>: only the cache subfolders, never the app’s settings.</li>
          <li><b>System junk</b>: your own crash reports in <code>/var/crash</code> and the previous desktop session log.</li>
          <li><b>Downloaded packages (apt)</b> in <code>/var/cache/apt/archives</code>, removed with <code>apt-get clean</code>.</li>
          <li><b>System journal over 100 MB</b>: older logs go, the newest 100 MB stay (<code>journalctl --vacuum-size=100M</code>).</li>
          <li><b>Disabled snap revisions</b>: the older copy snap keeps for rollback.</li>
          <li><b>Developer junk</b>: npm, pip, Gradle, Cargo and many more tool caches, <code>node_modules</code> and build folders in projects you have not touched for a while, unused Docker images and build cache.</li>
          <li><b>Large files and exact duplicates</b> in your own folders, always Check First and only ever moved to the Trash.</li>
          <li><b>Apps</b>: remove apt, Snap and Flatpak apps, and find data left by Snap and Flatpak apps and by apt packages that were removed but not purged.</li>
        </ul>
        <p>Items labelled <span className="badge safe">Safe to Clean</span> are rebuilt automatically. <span className="badge check">Check First</span> items lose nothing important but cost a re-download or a slower next build. See the full list in <a href="/guides/what-is-safe-to-delete/">what is safe to delete</a>.</p>

        <h2>Built-in alternatives</h2>
        <p>You can do much of this by hand. These tools come with most distributions:</p>
        <ul>
          <li><code>df -h</code> shows free space per drive, and <code>du -h --max-depth=1 ~ | sort -h</code> shows which folders in your home are largest.</li>
          <li><code>sudo apt clean</code> and <code>sudo apt autoremove</code> clear downloaded packages and packages nothing needs any more.</li>
          <li><code>sudo journalctl --vacuum-time=2weeks</code> trims old system logs.</li>
          <li>Desktops such as GNOME include a graphical disk usage analyzer that draws folder sizes as a ring chart. It shows sizes but does not tell you what is safe to delete.</li>
        </ul>
        <p>The <a href="/guides/free-up-space-ubuntu/">Ubuntu guide</a> walks through each command, and the <a href="/guides/developer-disk-cleanup/">developer guide</a> covers tool caches.</p>

        <h2>Frequently asked questions</h2>
        <Faq items={FAQ} />
        <p><a className="btn primary" href="/#download">Download Cleanzy for Linux</a></p>
      </article>
    </Shell>
  );
}
