import { Doc, GUIDES, meta } from '../site';

export const metadata = meta('/guides/', 'Disk Cleanup Guides for Mac, Windows & Linux',
  'Step-by-step guides to free up disk space safely: what is safe to delete, clearing developer caches, and freeing space on Ubuntu.');

export default function Guides() {
  return (
    <Doc crumbs={[['/guides/', 'Guides']]} title="Disk cleanup guides"
      lead="How to free up space by hand, with the exact commands and what each one costs. Every guide marks the steps that cannot be undone.">
      {GUIDES.map(([h, t, p]) => <div key={h}><h2><a href={h}>{t}</a></h2><p>{p}</p></div>)}
      <h2>Cleanzy for your system</h2>
      <p><a href="/mac/">Mac</a> · <a href="/windows/">Windows</a> · <a href="/linux/">Linux</a></p>
    </Doc>
  );
}
