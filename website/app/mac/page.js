import { Shell, Downloads, Faq, meta, appLd, faqLd, BUILDS } from '../site';

export const metadata = meta('/mac/', 'Free Mac Cleaner – Caches, Xcode Junk & App Leftovers',
  'Free Mac cleaner for macOS 11 or later. Clear Library caches, logs, Xcode DerivedData and simulators, and remove apps with their leftovers. No account.');

const FAQ = [
  ['Which Macs does Cleanzy run on?', 'macOS 11 or later, on Apple Silicon and Intel. Download the .dmg that matches your Mac: Apple menu → About This Mac shows the chip.'],
  ['Why does macOS say the app cannot be checked?', 'Cleanzy is not notarised yet. After moving it to Applications, run xattr -dr com.apple.quarantine /Applications/Cleanzy.app in Terminal once, then open it.'],
  ['Does Cleanzy need Full Disk Access?', 'It works without it, but macOS hides some folders, including the Trash, until you allow it in System Settings → Privacy & Security → Full Disk Access.'],
  ['Will it sign me out of apps?', 'Cache folders that can hold sign-ins, passwords, iCloud data or security software are never offered, so clearing caches should not sign you out.'],
  ['Does Cleanzy delete Time Machine snapshots?', 'No. Cleanzy does not touch local snapshots. They are one reason System Data can look large.'],
  ['How do I uninstall Cleanzy?', 'Drag Cleanzy.app from Applications to the Trash.'],
];

export default function Mac() {
  return (
    <Shell ld={[appLd('macOS', BUILDS.mac[0].links[0][1]), faqLd(FAQ)]}>
      <header className="hero os wrap">
        <h1>Free Mac cleaner for caches, Xcode junk and app leftovers</h1>
        <p className="lead">Clear the caches, logs and developer data that fill your Mac, and remove apps together with the files they leave in your Library. Every item is labelled Safe or Check First.</p>
        <Downloads os="mac" />
      </header>

      <article className="wrap narrow doc">
        <h2>Download and install</h2>
        <ol>
          <li>Download the <code>.dmg</code> for <b>Apple Silicon</b> (M1 and later) or <b>Intel</b>, and double-click it.</li>
          <li>In the window that opens, drag <b>Cleanzy</b> onto the <b>Applications</b> folder.</li>
          <li>The app is not notarised yet, so the first time run this in Terminal:<pre>xattr -dr com.apple.quarantine /Applications/Cleanzy.app</pre></li>
          <li>Open Cleanzy. To let it see every folder, turn it on in System Settings → Privacy &amp; Security → <b>Full Disk Access</b>.</li>
        </ol>

        <h2>What Cleanzy cleans on a Mac</h2>
        <ul>
          <li><b>App caches</b> in <code>~/Library/Caches</code>, grouped by app, and the cache folders of browsers and Electron apps in <code>~/Library/Application Support</code>. Caches that can hold sign-ins, passwords, iCloud or security software are never offered.</li>
          <li><b>Logs and crash reports</b> in <code>~/Library/Logs</code>.</li>
          <li><b>Old iPhone and iPad software updates</b>, Messages link previews, and screen saver videos (Check First, as they download again).</li>
          <li><b>Xcode junk</b>: DerivedData, the documentation cache, simulator caches and unavailable simulators. Xcode Archives and DeviceSupport are Check First, because Archives hold the dSYMs you need to read old crash reports.</li>
          <li><b>Developer caches</b> from Homebrew, CocoaPods, npm, pip and many more, plus <code>node_modules</code> and build folders in projects you have not touched for a while.</li>
          <li><b>Large files and exact duplicates</b> in your own folders, always Check First and only moved to the Trash.</li>
          <li><b>Installers</b> (.dmg, .pkg) and unfinished downloads in Downloads, as Check First.</li>
        </ul>
        <p>See every folder with its label in <a href="/guides/what-is-safe-to-delete/">what is safe to delete</a>, and the commands behind the developer items in the <a href="/guides/developer-disk-cleanup/">developer cleanup guide</a>.</p>

        <h2>Uninstall apps and their leftovers</h2>
        <p>Remove Apps lists the apps in your Applications folders with their size and when you last used them. Removing one moves the app to the Trash together with its files in your Library. Files named exactly after the app’s bundle ID are selected; looser name matches are shown for you to check; files another installed app also uses are left alone.</p>
        <p>It also finds <b>leftovers of apps you already deleted</b>: folders in <code>~/Library</code> (Caches, Preferences, Containers, Saved Application State and more) named after an app that is no longer installed. These are always Check First, never selected for you, and only moved to the Trash.</p>

        <h2>What is “System Data” on a Mac?</h2>
        <p>In System Settings → General → Storage, macOS puts everything it cannot sort into Apps, Documents or Photos under <b>System Data</b>. That includes caches, logs, temporary files, Time Machine local snapshots, virtual machine disks and developer data such as Xcode’s DerivedData and simulators.</p>
        <p>Cleanzy can shrink the parts that live in your home folder: app caches, logs, Xcode data, simulators and developer caches. It does not touch Time Machine snapshots or macOS system files, and System Data in Storage may take a while to update after a clean. Remember to empty the Trash: files in it still use space.</p>

        <h2>Frequently asked questions</h2>
        <Faq items={FAQ} />
        <p><a className="btn primary" href="/#download">Download Cleanzy for Mac</a></p>
      </article>
    </Shell>
  );
}
