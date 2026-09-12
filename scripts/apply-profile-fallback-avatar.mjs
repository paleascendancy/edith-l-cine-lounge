import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/index.js', import.meta.url);
let src = await readFile(path, 'utf8');

const start = src.indexOf('async function createProfileFallbackAvatar(');
const end = src.indexOf('\nasync function getMemberProfilePhoto(', start);

if (start < 0 || end < 0) {
  throw new Error('[PROFILE] Fallback avatar function not found');
}

const replacement = `async function createProfileFallbackAvatar(label = 'Membro') {
  const svg = \`
    <svg width="320" height="320" viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="avatarBg" x1="28" y1="24" x2="294" y2="302" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#171a25"/>
          <stop offset="52%" stop-color="#0d1018"/>
          <stop offset="100%" stop-color="#090a0f"/>
        </linearGradient>
        <linearGradient id="ring" x1="55" y1="42" x2="270" y2="288" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#f05d70"/>
          <stop offset="48%" stop-color="#a9273a"/>
          <stop offset="100%" stop-color="#58131f"/>
        </linearGradient>
        <linearGradient id="person" x1="121" y1="90" x2="215" y2="251" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#f4f5f7"/>
          <stop offset="100%" stop-color="#a8afbd"/>
        </linearGradient>
        <radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(160 160) rotate(90) scale(145)">
          <stop offset="0%" stop-color="#8e2335" stop-opacity=".28"/>
          <stop offset="100%" stop-color="#8e2335" stop-opacity="0"/>
        </radialGradient>
        <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity=".45"/>
        </filter>
      </defs>

      <circle cx="160" cy="160" r="159" fill="#05060a"/>
      <circle cx="160" cy="160" r="153" fill="url(#ring)"/>
      <circle cx="160" cy="160" r="145" fill="url(#avatarBg)"/>
      <circle cx="160" cy="160" r="140" fill="url(#glow)"/>

      <g opacity=".20" fill="#d84b5f">
        <rect x="34" y="80" width="18" height="8" rx="4"/>
        <rect x="34" y="104" width="18" height="8" rx="4"/>
        <rect x="34" y="128" width="18" height="8" rx="4"/>
        <rect x="34" y="152" width="18" height="8" rx="4"/>
        <rect x="34" y="176" width="18" height="8" rx="4"/>
        <rect x="34" y="200" width="18" height="8" rx="4"/>
        <rect x="268" y="80" width="18" height="8" rx="4"/>
        <rect x="268" y="104" width="18" height="8" rx="4"/>
        <rect x="268" y="128" width="18" height="8" rx="4"/>
        <rect x="268" y="152" width="18" height="8" rx="4"/>
        <rect x="268" y="176" width="18" height="8" rx="4"/>
        <rect x="268" y="200" width="18" height="8" rx="4"/>
      </g>

      <g filter="url(#shadow)">
        <circle cx="160" cy="126" r="48" fill="url(#person)"/>
        <path d="M79 260c7-53 38-82 81-82s74 29 81 82c-22 15-49 23-81 23s-59-8-81-23Z" fill="url(#person)"/>
      </g>

      <circle cx="160" cy="160" r="144" fill="none" stroke="#ffffff" stroke-opacity=".08" stroke-width="2"/>
      <path d="M250 58l12 12-12 12-12-12 12-12Z" fill="#ef6678" opacity=".72"/>
      <circle cx="68" cy="246" r="7" fill="#ef6678" opacity=".42"/>
    </svg>
  \`;

  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
`;

src = src.slice(0, start) + replacement + src.slice(end);
await writeFile(path, src, 'utf8');
console.log('[PROFILE] Avatar padrão cinematográfico aplicado para usuários sem foto.');
