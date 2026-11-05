import { Doc, meta } from '../site';

export const metadata = meta('/privacy/', 'Privacy – Cleanzy',
  'Cleanzy has no account, no analytics, no crash reporting and no update check. Exactly what the app reads, stores and sends, which is nothing.');

export default function Privacy() {
  return (
    <Doc crumbs={[['/privacy/', 'Privacy']]} title="Privacy" updated="24 Oct 2026"
      lead="Short version: Cleanzy does not send anything anywhere. There is no account, no analytics, no crash reporting and no update check.">

      <h2>What the app sends</h2>
      <p>Nothing. Cleanzy 1.3.0 contains no code that makes network requests: no telemetry, no usage statistics, no crash reports and no automatic update check. The only thing it opens outside itself is local: on a Mac, a button opens the Full Disk Access page of System Settings. The app window is locked to its own local files: it cannot load web pages, open new windows or navigate away, and its content security policy allows only the app’s own scripts.</p>
      <p>To get a new version, download it again from this site.</p>

      <h2>What the app reads</h2>
      <p>To find what can be cleaned, Cleanzy reads folder names and sizes on your computer, such as caches, build folders and your Downloads folder. To show its lists it runs standard tools that are already on your system, for example <code>du</code>, <code>git status</code>, <code>docker</code>, <code>snap list</code> or <code>journalctl --disk-usage</code>. All of this stays on your computer.</p>
      <p>Some of these tools can make their own network calls when you use them elsewhere; Cleanzy only runs the local listing and clean-up commands it shows you.</p>

      <h2>What the app stores</h2>
      <p>Your settings and cleaning history are saved in a single file, <code>cleanzy.json</code>, in Cleanzy’s own app data folder on your computer. Delete that folder to reset it.</p>
      <p>When a clean-up needs administrator rights (on Linux: apt, the system journal and snap revisions), Cleanzy asks for your password at that moment, passes it to <code>sudo</code> for that command, and never saves it to disk.</p>

      <h2>This website</h2>
      <p>This site has no analytics, no ads and no cookies. Like any web server, the host that serves these pages and downloads may keep standard access logs (IP address, time and file requested).</p>

      <p>Back to <a href="/">Cleanzy</a>.</p>
    </Doc>
  );
}
