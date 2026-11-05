import { Shell, Downloads, Faq, meta, appLd, faqLd, VERSION, BUILDS } from '../site';

export const metadata = meta('/windows/', 'Free Disk Cleaner for Windows 10 & 11',
  'Free disk cleaner for Windows 10 and 11. Goes beyond Storage Sense: app caches in AppData, developer caches, old node_modules, large files and duplicates.');

const FAQ = [
  ['Does Cleanzy work on Windows 10 and 11?', 'Yes, 64-bit Windows 10 and 11, on x64 and Arm64 PCs. Download the matching zip.'],
  ['Why does Windows say it protected my PC?', 'Cleanzy is not code-signed yet, so SmartScreen warns on first launch. Click More info, then Run anyway.'],
  ['Does it replace Storage Sense or Disk Cleanup?', 'No, use both. The built-in tools handle Windows Update leftovers and system files. Cleanzy covers caches of individual apps and developer tools, which the built-in tools do not list one by one.'],
  ['Does it edit the registry?', 'No. Cleanzy reads the list of installed programs from the registry to show them, but it does not clean or change registry entries. Removing an app opens that app’s own uninstaller.'],
  ['Where do cleaned files go?', 'To the Recycle Bin, unless you choose Delete Permanently.'],
  ['How do I uninstall Cleanzy?', 'Cleanzy is portable: delete the Cleanzy folder.'],
];

export default function Windows() {
  return (
    <Shell ld={[appLd('Windows 10, Windows 11', BUILDS.win[0].links[0][1]), faqLd(FAQ)]}>
      <header className="hero os wrap">
        <h1>Free disk cleaner for Windows 10 and 11</h1>
        <p className="lead">Find the caches, temporary files and developer junk that fill your drive, see what each item is, and clear the safe ones in one click.</p>
        <Downloads os="win" />
      </header>

      <article className="wrap narrow doc">
        <h2>Download and run</h2>
        <ol>
          <li>Download <code>Cleanzy-{VERSION}-win-x64.zip</code> (or <code>win-arm64</code> on an Arm PC) and open it.</li>
          <li>Drag the <b>Cleanzy</b> folder somewhere permanent, like Documents. There is no installer.</li>
          <li>Double-click <b>Cleanzy.exe</b>. If you see “Windows protected your PC”, click <b>More info</b> → <b>Run anyway</b>.</li>
        </ol>

        <h2>What Cleanzy cleans beyond Storage Sense and Disk Cleanup</h2>
        <p>Windows’ own Storage Sense and Disk Cleanup are good at system files: Windows Update leftovers, the Recycle Bin and system temporary files. Cleanzy looks at the things they leave alone:</p>
        <ul>
          <li><b>Per-app caches in AppData</b>: the <code>Cache</code>, <code>Code Cache</code> and <code>GPUCache</code> folders of browsers, chat apps and editors, grouped by app, so you can see which app holds how much.</li>
          <li><b>Your temporary files and crash dumps</b> in <code>%LOCALAPPDATA%\Temp</code> and <code>%LOCALAPPDATA%\CrashDumps</code>. Only the contents are cleared; the folders stay.</li>
          <li><b>Developer caches</b>: npm, pnpm, Yarn, pip, NuGet, Gradle, Cargo and more, plus <code>node_modules</code>, <code>bin</code>, <code>obj</code> and other build folders in projects you have not touched for a while.</li>
          <li><b>Large files and exact duplicates</b> in your own folders, sorted by size and age. These are always Check First and go only to the Recycle Bin.</li>
          <li><b>Old installers</b> (.exe, .msi) and unfinished downloads in Downloads, as Check First.</li>
          <li><b>Storage Map</b>: every folder by size, as a list or a colour map.</li>
          <li><b>Remove Apps</b>: your installed programs in one list; removing one opens its own uninstaller.</li>
        </ul>
        <p>Every item is labelled <span className="badge safe">Safe to Clean</span> or <span className="badge check">Check First</span>. One click takes only the safe ones. Folders that hold your documents, sign-ins or keys are never offered. See the <a href="/guides/what-is-safe-to-delete/">Windows table in the safe-to-delete guide</a>, and the <a href="/guides/developer-disk-cleanup/">developer cleanup guide</a> for doing it by hand.</p>

        <h2>Frequently asked questions</h2>
        <Faq items={FAQ} />
        <p><a className="btn primary" href="/#download">Download Cleanzy for Windows</a></p>
      </article>
    </Shell>
  );
}
