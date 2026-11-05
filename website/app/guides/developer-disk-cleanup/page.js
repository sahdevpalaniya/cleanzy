import { Doc, meta } from '../../site';

export const metadata = meta('/guides/developer-disk-cleanup/', 'How to Clear Developer Caches and Free Disk Space',
  'Commands to clear node_modules, npm, Yarn, pnpm, pip, Gradle, Maven and Cargo caches, Xcode DerivedData, Docker build cache and orphaned git worktrees safely.');

const W = ({ children }) => <p className="warn"><b>Warning:</b> {children}</p>;

export default function Guide() {
  return (
    <Doc crumbs={[['/guides/', 'Guides'], ['/guides/developer-disk-cleanup/', 'Developer disk cleanup']]}
      title="How to clear developer caches and free disk space"
      lead="Package managers, build tools and containers keep copies of everything they download or build. On a developer machine that is often tens of gigabytes. Here is how to find and clear it by hand, tool by tool, and which parts cost you something.">

      <h2>Before you start: find what is big</h2>
      <p>Check free space and the largest hidden folders in your home folder (macOS and Linux):</p>
      <pre>{`df -h ~
du -sh ~/.[!.]* ~/Library/Caches 2>/dev/null | sort -h | tail -20`}</pre>
      <p>Everything below is a cache: the tool downloads or rebuilds it when needed. The cost is time and bandwidth on the next install or build, nothing more, except where a warning says otherwise.</p>

      <h2>node_modules in stale projects</h2>
      <p>Each JavaScript project keeps its own <code>node_modules</code>, often hundreds of megabytes. Projects you have not opened in months are the best target. List them with their sizes:</p>
      <pre>{`find ~/projects -type d -name node_modules -prune -exec du -sh {} + | sort -h`}</pre>
      <p>Delete one, then restore it when you return to the project:</p>
      <pre>{`rm -rf ~/projects/old-site/node_modules
cd ~/projects/old-site && npm ci      # or: pnpm install, yarn, bun install`}</pre>
      <p>If the project has no lockfile (<code>package-lock.json</code>, <code>yarn.lock</code>, <code>pnpm-lock.yaml</code>), a reinstall may pick newer package versions than the ones you had.</p>

      <h2>npm, Yarn and pnpm caches</h2>
      <pre>{`npm cache verify          # checks the cache and removes unneeded data
npm cache clean --force   # removes the whole cache (~/.npm/_cacache)
yarn cache clean          # Yarn 1; on Yarn 2+ use: yarn cache clean --all
pnpm store prune          # removes packages no project references`}</pre>
      <p>The next install downloads what it needs again. <code>pnpm store prune</code> is the safest of these: it keeps everything a project still uses.</p>

      <h2>pip cache</h2>
      <pre>{`pip cache info
pip cache purge`}</pre>
      <p>This removes downloaded wheels only. Installed packages and virtual environments are not affected.</p>

      <h2>Gradle and Maven</h2>
      <pre>{`./gradlew --stop           # stop running Gradle daemons first
rm -rf ~/.gradle/caches`}</pre>
      <p>Gradle downloads dependencies and rebuilds its caches on the next build. Your <code>~/.gradle/gradle.properties</code> is kept.</p>
      <pre>{`rm -rf ~/.m2/repository`}</pre>
      <W>the Maven repository also holds artifacts you built yourself with <code>mvn install</code>, which cannot be downloaded again. Rebuild those projects afterwards. On a slow connection, re-downloading everything takes a while.</W>

      <h2>Cargo (Rust)</h2>
      <pre>{`rm -rf ~/.cargo/registry/cache ~/.cargo/registry/src ~/.cargo/git`}</pre>
      <p>Cargo downloads crates again on the next <code>cargo build</code>. Do not delete <code>~/.cargo/bin</code>: that is where installed tools live. Each project’s <code>target</code> folder is build output and can be removed with <code>cargo clean</code> inside the project.</p>

      <h2>Xcode: DerivedData vs Archives</h2>
      <p><b>DerivedData</b> holds intermediate build products. Quit Xcode, then:</p>
      <pre>{`rm -rf ~/Library/Developer/Xcode/DerivedData`}</pre>
      <p>Xcode rebuilds it on the next build, which is slower once. Simulators that no longer match an installed runtime can go too:</p>
      <pre>{`xcrun simctl delete unavailable`}</pre>
      <p><b>Archives</b> (<code>~/Library/Developer/Xcode/Archives</code>) are different.</p>
      <W>Archives are not re-created. They hold the builds you shipped and their dSYM files, which you need to read crash reports from those versions. Delete only archives of versions you no longer support, from Xcode’s Organizer window, not the whole folder.</W>
      <p><b>iOS DeviceSupport</b> holds debug symbols copied from each iOS version you connected. It is copied again when a device on that version reconnects, so old versions can go.</p>

      <h2>Docker: build cache vs volumes</h2>
      <p>See what Docker uses first:</p>
      <pre>{`docker system df`}</pre>
      <p>The build cache and dangling (untagged) images are safe to remove:</p>
      <pre>{`docker builder prune    # build cache; the next build is slower
docker image prune      # untagged images only`}</pre>
      <W><code>docker volume prune</code> deletes volumes no container uses, and volumes often hold databases. Their data is gone for good. List them with <code>docker volume ls -f dangling=true</code> and remove only the ones you recognise.</W>
      <W><code>docker system prune -a</code> removes every image not used by a running or stopped container, plus stopped containers and networks. Everything is pulled or rebuilt again, which can take a long time. Add <code>--volumes</code> and it deletes unused volumes too. Prefer the targeted commands above.</W>

      <h2>Orphaned git worktrees</h2>
      <p>A git worktree is an extra checkout of a repository. Coding tools often create them in hidden folders in your home folder. When the main repository forgets a worktree, its folder stays behind with a full copy of the code.</p>
      <pre>{`git worktree list     # in the main repository: worktrees git knows about
git worktree prune    # forgets worktrees whose folder is already gone`}</pre>
      <p>A worktree folder whose <code>.git</code> file points to a path that no longer exists is orphaned:</p>
      <pre>{`cat path/to/worktree/.git    # shows "gitdir: ..."; check that path exists`}</pre>
      <W>an orphaned worktree can still hold uncommitted or unpushed work. Copy, commit or push anything you need before deleting the folder.</W>

      <h2>Doing it in Cleanzy</h2>
      <p>Cleanzy’s Developer Junk view finds all of the above in one scan: the caches of 70+ package managers, build tools and IDEs, <code>node_modules</code> and build folders in your projects, Docker build cache, images and volumes, unavailable simulators and orphaned worktrees. Each item shows its size and, where there is one, the command that restores it.</p>
      <ul>
        <li>Projects you used in the last 3 months are left out by default. You can change this in Settings, from 1 month to 2 years, or show all projects.</li>
        <li>Project folders with uncommitted changes, without a lockfile, or not ignored by git are labelled Check First and never selected for you.</li>
        <li>DerivedData, the npm, pip, Gradle and Cargo caches and the Docker build cache are <span className="badge safe">Safe to Clean</span>. Xcode Archives, the Maven repository, <code>node_modules</code>, unused Docker images and volumes, and orphaned worktrees are <span className="badge check">Check First</span>.</li>
        <li>Files go to the Trash unless you choose Delete Permanently. Docker and simulator clean-ups run as commands and are permanent.</li>
      </ul>
      <p>Get it for <a href="/mac/">Mac</a>, <a href="/windows/">Windows</a> or <a href="/linux/">Linux</a>. For the full label list see <a href="/guides/what-is-safe-to-delete/">what is safe to delete</a>.</p>
    </Doc>
  );
}
