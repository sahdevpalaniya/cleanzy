'use client';
// Client parts: OS/arch detection for the download buttons, and the install tabs.
import { useEffect, useState } from 'react';

import { VERSION, BUILDS, NAME } from './site';
export { VERSION, BUILDS, NAME };

// Recommended build: first row, the link matching the CPU. Mac can't tell Apple Silicon from Intel, so it stays on Apple Silicon.
const pick = (os, arm) => { const l = BUILDS[os][0].links; return os === 'mac' ? l[0] : l[arm ? 1 : 0]; };

// null on the server and before detection; then { os: 'win'|'mac'|'linux'|'mobile'|null, arm }
function useSystem() {
  const [sys, setSys] = useState(null);
  useEffect(() => {
    const ua = navigator.userAgent;
    const os = /iPhone|iPad|iPod|Android/.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1) ? 'mobile'
      : /Win/.test(ua) ? 'win' : /Mac/.test(ua) ? 'mac' : /Linux|X11|CrOS/.test(ua) ? 'linux' : null;
    setSys({ os, arm: false });
    navigator.userAgentData?.getHighEntropyValues(['architecture', 'bitness'])
      .then(v => setSys({ os, arm: v.architecture === 'arm' })).catch(() => {});
  }, []);
  return sys;
}

export function HeroDownload({ icons }) {
  const sys = useSystem();
  const os = NAME[sys?.os] ? sys.os : null;
  const [arch, href] = os ? pick(os, sys.arm) : [];
  return (
    <div className="hero-cta">
      <div className="actions">
        {os
          ? <a className="btn primary big" href={href} download>{icons[os]}Download for {NAME[os]}{os === 'linux' ? ' (.deb)' : ''}</a>
          : <a className="btn primary big" href="#download">Download Cleanzy</a>}
        <a className="more" href="#download">Other platforms</a>
      </div>
      {sys?.os === 'mobile' && <p className="note">Cleanzy is a desktop app. Open this page on your computer to download it.</p>}
      <p className="meta">Free · Version {VERSION}{os ? ` · ${arch}` : ' · Windows, macOS and Linux'}</p>
    </div>
  );
}

export function DownloadCards({ meta }) {
  const sys = useSystem();
  return (
    <>
      {sys?.os === 'mobile' && <p className="note center">Cleanzy is a desktop app. Open this page on your computer to download it.</p>}
      <div className="dl">
        {Object.keys(NAME).map(k => {
          const me = sys?.os === k;
          const [arch, href] = pick(k, me && sys.arm);
          return (
            <div key={k} className={`dlc${me ? ' me' : ''}`}>
              <div className="os">{meta[k].icon}<h3>{NAME[k]}</h3><span className="you">{me ? 'Your system' : ''}</span></div>
              <a className="btn primary big" href={href} download>Download{k === 'linux' ? ' .deb' : ''} <span>{arch}</span></a>
              <p className="req">{meta[k].req}</p>
              <table className="builds">
                <tbody>
                  {BUILDS[k].map(r => (
                    <tr key={r.fmt}>
                      <th scope="row"><code>{r.fmt}</code>{r.note && <small>{r.note}</small>}</th>
                      <td>{r.links.map(([a, h]) => <a key={h} className="arch" href={h} download aria-label={`${NAME[k]} ${r.fmt} ${a}`}>{a}</a>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {k === 'mac' && <p className="req">Not sure? Apple menu → About This Mac.</p>}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function InstallTabs({ steps }) {
  const sys = useSystem();
  const [sel, setSel] = useState('win');
  useEffect(() => { if (NAME[sys?.os]) setSel(sys.os); }, [sys?.os]);
  const keys = Object.keys(NAME);
  const key = (e, i) => {
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (!d) return;
    const n = keys[(i + d + keys.length) % keys.length]; setSel(n); document.getElementById('tab-' + n)?.focus();
  };
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Operating system">
        {keys.map((k, i) => (
          <button key={k} id={'tab-' + k} role="tab" aria-selected={sel === k} aria-controls={'p-' + k} tabIndex={sel === k ? 0 : -1}
            onClick={() => setSel(k)} onKeyDown={e => key(e, i)}>{NAME[k]}</button>
        ))}
      </div>
      {keys.map(k => (
        <div key={k} id={'p-' + k} role="tabpanel" aria-labelledby={'tab-' + k} hidden={sel !== k} className="panel" tabIndex={0}>
          <ol>{steps[k]}</ol>
        </div>
      ))}
    </>
  );
}
