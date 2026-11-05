import { Doc, meta } from '../../site';

export const metadata = meta('/guides/what-is-safe-to-delete/', 'Is It Safe to Delete Cache Folders? Mac, Windows, Linux',
  'Which cache folders are safe to delete on macOS, Windows and Linux, and which to check first. Folder-by-folder tables with the reason for each.');

const S = 'safe', C = 'check';
const MAC = [
  ['~/Library/Caches/<app>', S, 'App caches. Rebuilt automatically the next time the app runs.'],
  ['~/Library/Application Support/<app>/Cache, Code Cache, GPUCache', S, 'Browser and Electron app caches. Only these subfolders, never the app’s data folder.'],
  ['~/Library/Logs', S, 'Old diagnostic logs apps wrote while running.'],
  ['~/Library/Logs/DiagnosticReports', S, 'Reports from apps that crashed. Nothing reads them later.'],
  ['~/Library/iTunes/iPhone Software Updates', S, 'Firmware downloaded to update a device. Downloaded again when needed.'],
  ['~/Library/Messages/Caches/Previews', S, 'Link and attachment thumbnails. Messages redraws them.'],
  ['~/Library/Developer/Xcode/DerivedData', S, 'Intermediate build products. Xcode rebuilds them on the next build.'],
  ['~/Library/Developer/CoreSimulator/Caches', S, 'Simulator caches, rebuilt when a simulator runs.'],
  ['~/Library/Caches/Homebrew, ~/Library/Caches/CocoaPods', S, 'Downloaded copies. Fetched again when needed.'],
  ['~/Library/Developer/Xcode/Archives', C, 'Archived app builds, including the dSYMs you need to read old crash reports. Not re-created.'],
  ['~/Library/Developer/Xcode/iOS DeviceSupport', C, 'Debug symbols copied from each iOS version you connected. Copied again when a device reconnects.'],
  ['Unavailable simulators', C, 'Simulators for runtimes you no longer have. Removed permanently; Xcode re-creates them on demand.'],
  ['~/Library/Application Support/com.apple.wallpaper/aerials/videos', C, 'Screen saver videos. Downloaded again when shown, a few GB each.'],
  ['~/Library/Containers/com.apple.mail/…/Mail Downloads', C, 'Attachments you opened from Mail. They stay in the emails. Quit Mail first.'],
  ['~/Library/Containers/com.docker.docker', C, 'Docker Desktop’s whole virtual disk: every image, container and volume. It starts empty.'],
  ['.dmg and .pkg files in Downloads', C, 'Installers. You can download them again.'],
];
const WIN = [
  ['%LOCALAPPDATA%\\Temp (contents)', S, 'Leftovers from installers and apps.'],
  ['%LOCALAPPDATA%\\CrashDumps (contents)', S, 'Memory dumps from apps that crashed.'],
  ['%LOCALAPPDATA%\\<app>\\…\\Cache, Code Cache, GPUCache, cache2', S, 'Browser and app caches. Rebuilt automatically the next time the app runs.'],
  ['%APPDATA%\\<app>\\Cache, Code Cache, GPUCache', S, 'Electron app caches. Only these subfolders, never the app’s data.'],
  ['%LOCALAPPDATA%\\npm-cache\\_cacache, pip\\Cache, Yarn\\Cache', S, 'Downloaded packages. Fetched again when a project needs them.'],
  ['%USERPROFILE%\\.gradle\\caches', S, 'Gradle downloads and build caches. Fetched again on the next build.'],
  ['%USERPROFILE%\\.nuget\\packages', C, 'Downloaded NuGet packages. Fetched again by dotnet restore, which can be large or slow.'],
  ['%USERPROFILE%\\.m2\\repository', C, 'Maven packages, fetched again by mvn install. Also holds artifacts you installed yourself.'],
  ['.exe and .msi files in Downloads', C, 'Installers. You can download them again.'],
];
const LINUX = [
  ['~/.cache/<app>', S, 'App caches. Rebuilt automatically the next time the app runs.'],
  ['~/.cache/thumbnails', S, 'Picture previews, redrawn when you next open the folder.'],
  ['~/.cache/fontconfig', S, 'Rebuilt automatically the next time an app loads fonts.'],
  ['~/.cache/mesa_shader_cache, ~/.cache/nvidia', S, 'Graphics shader cache. Rebuilt the next time an app draws on screen.'],
  ['~/snap/<app>/common/.cache, ~/.var/app/<id>/cache', S, 'Caches of Snap and Flatpak apps.'],
  ['Your files in /var/crash', S, 'Reports from apps that crashed. Nothing reads them later.'],
  ['~/.xsession-errors.old', S, 'Desktop session log from your last login.'],
  ['~/.npm/_cacache, ~/.cache/pip, ~/.cache/yarn', S, 'Downloaded packages. Fetched again when a project needs them.'],
  ['/var/cache/apt/archives', C, 'Downloaded packages, removed with apt clean (needs your password). Downloaded again when needed.'],
  ['/var/log/journal over 100 MB', C, 'Old system logs. Permanent once removed; the newest 100 MB are kept.'],
  ['Disabled snap revisions', C, 'An older version snap keeps to roll back to.'],
  ['~/.cache/huggingface, ~/.cache/ms-playwright', C, 'AI models and test browsers. Fetched again on next use, often many GB.'],
  ['~/.m2/repository', C, 'Maven packages. Fetched again by mvn install, which can be slow.'],
];
const DEV = [
  ['node_modules in a project', C, 'Installed packages. Downloaded again by npm ci, pnpm install or yarn.'],
  ['build, dist, .next, out (with package.json)', S, 'Build output. Your build script writes it again.'],
  ['__pycache__, .pytest_cache, .mypy_cache', S, 'Python caches. Recreated the next time the code runs.'],
  ['venv, .venv', C, 'Python virtual environment. Rebuilt by reinstalling the packages.'],
  ['target (Cargo or Maven project)', C, 'Compiled build output. A full rebuild can take a while.'],
  ['Pods (with a Podfile)', C, 'CocoaPods dependencies. Downloaded again by pod install.'],
  ['Orphaned git worktree', C, 'Commit or push anything you need first.'],
];

const Badge = ({ s }) => s === S ? <span className="badge safe">Safe to Clean</span> : <span className="badge check">Check First</span>;
const Table = ({ rows }) => (
  <div className="tbl"><table>
    <thead><tr><th scope="col">Folder</th><th scope="col">Label</th><th scope="col">Why</th></tr></thead>
    <tbody>{rows.map(([f, s, w]) => <tr key={f}><td><code>{f}</code></td><td><Badge s={s} /></td><td>{w}</td></tr>)}</tbody>
  </table></div>
);

export default function Guide() {
  return (
    <Doc crumbs={[['/guides/', 'Guides'], ['/guides/what-is-safe-to-delete/', 'What is safe to delete']]}
      title="Is it safe to delete cache folders? macOS, Windows and Linux"
      lead="Mostly, yes: a cache is data an app can rebuild. But some folders called caches hold sign-ins, downloads that take hours to fetch again, or files that are never re-created. These tables use the same two labels as Cleanzy, with the same reasons.">

      <h2>What the two labels mean</h2>
      <ul>
        <li><Badge s={S} />: rebuilt automatically. You will not notice it is gone, apart from an app starting a little slower once.</li>
        <li><Badge s={C} />: nothing important is lost, but it costs a re-download, a slow rebuild, or it holds something you may want (such as crash symbols). Look at it before you delete it.</li>
      </ul>
      <p>Quit an app before clearing its cache, and empty the Trash afterwards: files in the Trash still use space.</p>

      <h2>macOS</h2>
      <Table rows={MAC} />
      <h2>Windows</h2>
      <Table rows={WIN} />
      <h2>Linux</h2>
      <Table rows={LINUX} />
      <h2>Project folders (all systems)</h2>
      <p>These sit inside your projects. A folder that holds uncommitted changes or is not ignored by git may contain your own work, so it is always Check First.</p>
      <Table rows={DEV} />

      <h2>Never delete these</h2>
      <p>Some folders look like clutter but hold things you cannot get back. Cleanzy never offers them, and you should not delete them by hand:</p>
      <ul>
        <li>Your Desktop, Documents, Downloads, Pictures, Music and Movies or Videos folders as a whole.</li>
        <li><code>~/.ssh</code>, <code>~/.gnupg</code>, <code>~/.aws</code>, <code>~/.kube</code> and <code>~/.password-store</code>: keys and credentials.</li>
        <li><code>~/Library/Keychains</code>, <code>~/Library/Mail</code> and <code>~/Library/Application Support/MobileSync</code> (iPhone and iPad backups) on a Mac.</li>
        <li><code>~/Library/Preferences</code>, <code>~/Library/Application Support</code>, <code>%APPDATA%</code> and <code>~/.config</code> as a whole: every app’s settings.</li>
        <li>Your browser and mail profiles (<code>~/.mozilla</code>, <code>~/.thunderbird</code>) and Android keys (<code>~/.android/avd</code>, <code>debug.keystore</code>).</li>
        <li>Cache folders of password managers, sign-in and iCloud services, and security software. Their “cache” can hold tokens, so clearing it signs you out or upsets device management.</li>
        <li>System folders such as <code>/usr</code>, <code>/etc</code>, <code>/System</code> and <code>C:\Windows</code>.</li>
      </ul>

      <h2>Let Cleanzy check for you</h2>
      <p>Cleanzy applies these rules on every scan and shows the label and reason beside each item. One click takes only the Safe items; Check First items are yours to tick. Get it for <a href="/mac/">Mac</a>, <a href="/windows/">Windows</a> or <a href="/linux/">Linux</a>, or clear things by hand with the <a href="/guides/developer-disk-cleanup/">developer guide</a> and the <a href="/guides/free-up-space-ubuntu/">Ubuntu guide</a>.</p>
    </Doc>
  );
}
