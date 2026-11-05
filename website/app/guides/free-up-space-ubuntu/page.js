import { Doc, meta } from '../../site';

export const metadata = meta('/guides/free-up-space-ubuntu/', 'How to Free Up Disk Space on Ubuntu',
  'Free up disk space on Ubuntu: find big folders with df and du, clear apt packages, old journal logs, old snap revisions, old kernels, ~/.cache and the Trash.');

const W = ({ children }) => <p className="warn"><b>Warning:</b> {children}</p>;

export default function Guide() {
  return (
    <Doc crumbs={[['/guides/', 'Guides'], ['/guides/free-up-space-ubuntu/', 'Free up space on Ubuntu']]}
      title="How to free up disk space on Ubuntu"
      lead="Current commands for Ubuntu and other Debian-based systems, from the safest to the ones that need a closer look. Each step says what it removes and whether it can be undone.">

      <h2>1. See where the space went</h2>
      <pre>{`df -h /                                   # free space on the system drive
du -h --max-depth=1 ~ 2>/dev/null | sort -h | tail -15
sudo du -xh --max-depth=1 / 2>/dev/null | sort -h | tail -15`}</pre>
      <p><code>-x</code> keeps <code>du</code> on one file system, so other drives and <code>/proc</code> are not counted. Run the last command again on the largest folder it shows (for example <code>/var</code>) to go one level deeper.</p>

      <h2>2. Clear downloaded packages and unused dependencies</h2>
      <pre>{`sudo apt clean`}</pre>
      <p>Removes the package files apt downloaded to <code>/var/cache/apt/archives</code>. Installed software is not affected; apt downloads a package again if it needs it.</p>
      <pre>{`sudo apt autoremove`}</pre>
      <p>Removes packages that were installed as dependencies and that nothing needs any more.</p>
      <W>read the list apt prints before you answer yes. If it includes something you use, answer no and mark it as wanted with <code>sudo apt-mark manual &lt;package&gt;</code>.</W>

      <h2>3. Trim the system journal</h2>
      <pre>{`journalctl --disk-usage
sudo journalctl --vacuum-time=2weeks     # or keep a size: --vacuum-size=100M`}</pre>
      <p>Deletes archived system logs older than two weeks. Recent logs stay, so you can still troubleshoot current problems. Removed logs cannot be recovered.</p>

      <h2>4. Remove old snap revisions</h2>
      <p>Snap keeps the previous version of each app so it can roll back. List the disabled ones:</p>
      <pre>{`snap list --all | awk '/disabled/{print $1, $3}'`}</pre>
      <p>Remove one by name and revision number:</p>
      <pre>{`sudo snap remove <name> --revision=<rev>`}</pre>
      <p>Only remove revisions marked <code>disabled</code>: the current one is in use. To keep fewer revisions in future, <code>sudo snap set system refresh.retain=2</code> (2 is the minimum). Each app’s own cache lives in <code>~/snap/&lt;app&gt;/common/.cache</code>.</p>

      <h2>5. Remove old kernels</h2>
      <p>Ubuntu keeps older kernels after an update, each a few hundred megabytes. Check which one you are running and which are installed:</p>
      <pre>{`uname -r
dpkg --list 'linux-image-*' | grep ^ii`}</pre>
      <p><code>sudo apt autoremove --purge</code> removes kernels Ubuntu no longer needs, keeping the running one and the previous one as a fallback.</p>
      <W>never remove the kernel shown by <code>uname -r</code>, and keep at least one older kernel that boots. Removing kernels by hand with <code>apt purge</code> can leave the system unable to start. Reboot into the newest kernel first, and let <code>autoremove</code> decide.</W>

      <h2>6. Clear ~/.cache</h2>
      <pre>{`du -sh ~/.cache/* 2>/dev/null | sort -h | tail -15`}</pre>
      <p>Apps keep rebuildable data here. Close the app, then remove its folder, for example thumbnails:</p>
      <pre>{`rm -rf ~/.cache/thumbnails`}</pre>
      <p>Most folders are safe, but a few hold large downloads that are slow to fetch again, such as AI models (<code>~/.cache/huggingface</code>) or test browsers (<code>~/.cache/ms-playwright</code>). Remove folders one by one rather than all of <code>~/.cache</code>. Developer caches are covered in the <a href="/guides/developer-disk-cleanup/">developer cleanup guide</a>.</p>

      <h2>7. Empty the Trash</h2>
      <p>Files you delete in Files go to <code>~/.local/share/Trash</code> and still use space. Empty it from the Trash in Files, or run:</p>
      <pre>{`gio trash --empty`}</pre>
      <p>Files on other drives have their own Trash folder on that drive (<code>.Trash-1000</code>), which the Files app empties too.</p>

      <h2>The GUI route: Cleanzy</h2>
      <p>Cleanzy does steps 1, 2, 3, 4, 6 and 7 in one window. The Storage Map replaces <code>du</code> with a treemap, and the scan lists, with their sizes:</p>
      <ul>
        <li>App caches in <code>~/.cache</code> and the caches of Snap and Flatpak apps, labelled <span className="badge safe">Safe to Clean</span>.</li>
        <li>Downloaded packages (apt), the system journal over 100 MB, and disabled snap revisions, labelled <span className="badge check">Check First</span>. These need your password, are never selected for you, and run as the same commands shown above.</li>
        <li>Your crash reports in <code>/var/crash</code>, developer caches, and big files in your own folders.</li>
      </ul>
      <p>Cleanzy does not remove kernels; use step 5 for those. Files go to the Trash unless you choose Delete Permanently, and the Empty Trash button frees the space. Install it from the <a href="/linux/">Linux page</a> (.deb or .tar.gz). For what each label means, see <a href="/guides/what-is-safe-to-delete/">what is safe to delete</a>.</p>
    </Doc>
  );
}
