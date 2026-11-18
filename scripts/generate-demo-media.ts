/** Generates the demonstration media used by the public repository (src/assets/demo).
 *
 * Every file is drawn here from vector shapes (no photography, no third-party material, no
 * client imagery), so the globe, the works gallery and the orbital space tour can be built,
 * tested and explored without redistributing the business's original photos. Dimensions
 * mirror the originals so layout, framing and the 3D scenes behave the same.
 *
 *   npm run demo-media                           → images, posters and manifest.json
 *   FFMPEG_PATH=/path/to/ffmpeg npm run demo-media → also encodes the two WebM loops
 *
 * Output is deterministic for a given sharp/libvips version; manifest.json records the
 * SHA-256 of each file and tests/media-policy.test.ts checks the shipped files against it. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'src', 'assets', 'demo');

const C = {
  ink: '#101211', deep: '#0a211b', emerald: '#103d32', emeraldLight: '#1d5a49',
  gold: '#c5a36a', goldLight: '#e5c891', bronze: '#8f7140', ivory: '#f1eadf', marble: '#ece7df',
};

// ---------------------------------------------------------------- helpers

function rng(seed: string) {
  let h = 2166136261;
  for (const char of seed) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const f = (n: number) => Number(n.toFixed(1));

interface Scene { readonly w: number; readonly h: number; readonly r: Rand }

/** A drawing in a normalised box, placed centred inside the frame at `scale` of its short side. */
function place({ w, h }: Scene, box: [number, number], scale: number, body: string, dy = 0) {
  const k = (Math.min(w / box[0], h / box[1])) * scale;
  const x = (w - box[0] * k) / 2;
  const y = (h - box[1] * k) / 2 + dy * h;
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${k.toFixed(4)})">${body}</g>`;
}

function backdrop({ w, h, r }: Scene, tone: 'emerald' | 'ink' | 'night' = 'emerald') {
  const [a, b] = tone === 'ink' ? [C.ink, C.deep] : tone === 'night' ? ['#0b1424', C.ink] : [C.emeraldLight, C.deep];
  const cx = f(30 + r() * 40);
  const lines = Array.from({ length: 5 }, (_, i) => {
    const x = f(w * (0.1 + i * 0.22 + r() * 0.05));
    return `<line x1="${x}" y1="0" x2="${f(x - h * 0.35)}" y2="${h}" stroke="${C.gold}" stroke-opacity="0.07" stroke-width="${f(Math.max(1, w / 600))}"/>`;
  }).join('');
  return `<defs><radialGradient id="bg" cx="${cx}%" cy="35%" r="85%"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>
  <linearGradient id="goldFill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.goldLight}"/><stop offset="1" stop-color="${C.bronze}"/></linearGradient>
  <radialGradient id="glow"><stop offset="0" stop-color="${C.goldLight}" stop-opacity="0.85"/><stop offset="1" stop-color="${C.goldLight}" stop-opacity="0"/></radialGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>${lines}`;
}

/** Visible marking: these images are illustrations, never photos of real work. */
function label({ w, h }: Scene, text: string) {
  const s = Math.min(w, h) / 1000;
  const pad = 44 * s;
  return `<g font-family="Segoe UI, Arial, sans-serif" fill="${C.ivory}">
  <rect x="${f(pad)}" y="${f(pad)}" width="${f(150 * s)}" height="${f(52 * s)}" rx="${f(26 * s)}" fill="${C.ink}" fill-opacity="0.55" stroke="${C.gold}" stroke-width="${f(2 * s)}"/>
  <text x="${f(pad + 75 * s)}" y="${f(pad + 35 * s)}" font-size="${f(26 * s)}" letter-spacing="${f(6 * s)}" text-anchor="middle" fill="${C.goldLight}">DEMO</text>
  <text x="${f(pad)}" y="${f(h - pad)}" font-size="${f(34 * s)}" font-family="Georgia, 'Times New Roman', serif" font-style="italic">${text}</text>
  <text x="${f(pad)}" y="${f(h - pad - 48 * s)}" font-size="${f(20 * s)}" letter-spacing="${f(5 * s)}" fill="${C.gold}">ILUSTRACIÓN DE DEMOSTRACIÓN</text></g>`;
}

// ---------------------------------------------------------------- motifs (normalised boxes)

const HEAD = 'M38 118C38 104 34 96 30 88C22 76 20 58 24 44C28 26 44 16 60 18C74 20 82 30 83 42L84 50C86 54 90 60 88 62C87 64 84 64 84 66C85 68 85 70 83 71C84 73 83 75 81 76C80 80 76 82 70 82C66 86 64 92 64 100L66 118Z';

type Cut = 'texture' | 'curly' | 'line' | 'fade' | 'shaved' | 'beard' | 'platinum' | 'styled';

function profile(cut: Cut, r: Rand) {
  const hairColor = cut === 'platinum' ? '#e8dcc0' : '#1a1512';
  const strands = cut === 'curly'
    ? Array.from({ length: 26 }, () => `<circle cx="${f(30 + r() * 50)}" cy="${f(16 + r() * 18)}" r="${f(2.6 + r() * 2.2)}" fill="none" stroke="${C.gold}" stroke-width="0.9"/>`).join('')
    : Array.from({ length: 22 }, (_, i) => {
      const x = 28 + i * 2.5;
      return `<path d="M${f(x)} ${f(40 - i * 0.6)}q${f(3 + r() * 3)} ${f(-8 - r() * 6)} ${f(6 + r() * 4)} ${f(-12 - r() * 4)}" stroke="${C.goldLight}" stroke-opacity="0.75" stroke-width="0.8" fill="none"/>`;
    }).join('');
  const cap = cut === 'shaved' || cut === 'beard'
    ? `<path d="M26 44C26 28 40 18 58 18C72 18 80 26 82 38C70 32 50 32 36 40Z" fill="${hairColor}" opacity="0.35"/>`
    : `<path d="M24 46C22 30 36 12 58 12C74 12 84 22 85 36C76 30 66 28 58 30C46 32 34 40 30 54Z" fill="${hairColor}"/>${strands}`;
  const fade = cut === 'shaved' ? '' : `<path d="M26 50C28 60 34 66 42 68L44 52C38 50 32 48 26 50Z" fill="url(#fade)" opacity="0.9"/>`;
  const part = cut === 'line' ? `<path d="M40 26L66 22" stroke="${C.ivory}" stroke-width="1.2"/>` : '';
  const beard = cut === 'beard' || cut === 'styled'
    ? `<path d="M52 62C56 74 64 84 72 84C78 84 82 80 82 76C76 78 70 74 66 66Z" fill="#1a1512" stroke="${C.gold}" stroke-width="0.6"/>` : '';
  return `<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hairColor}"/><stop offset="1" stop-color="${hairColor}" stop-opacity="0"/></linearGradient>
  <linearGradient id="skin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9c3a0"/><stop offset="1" stop-color="#9c7d55"/></linearGradient></defs>
  <path d="${HEAD}" fill="url(#skin)" stroke="${C.gold}" stroke-width="1.1"/>${fade}${cap}${part}${beard}
  <ellipse cx="50" cy="56" rx="4" ry="6" fill="none" stroke="${C.bronze}" stroke-width="1"/>
  <path d="M10 125C20 108 34 104 40 118L66 118C72 104 92 108 100 125Z" fill="${C.ink}" stroke="${C.gold}" stroke-width="0.8"/>`;
}

function hairBack(color: string, style: 'waves' | 'straight', r: Rand) {
  const strands = Array.from({ length: 30 }, (_, i) => {
    const x = 22 + i * 2;
    const wave = style === 'waves' ? 5 + r() * 3 : 0.6;
    let d = `M${x} 24`;
    for (let y = 24; y < 128; y += 13) d += `q${f(wave)} 6.5 0 13`;
    return `<path d="${d}" stroke="${i % 3 ? C.goldLight : C.ivory}" stroke-opacity="${style === 'waves' ? 0.55 : 0.35}" stroke-width="0.7" fill="none"/>`;
  }).join('');
  return `<path d="M0 140C10 112 30 104 50 104C70 104 90 112 100 140Z" fill="${C.ink}" stroke="${C.gold}" stroke-width="0.8"/>
  <path d="M50 8C30 8 18 24 18 44L16 128C30 136 70 136 84 128L82 44C82 24 70 8 50 8Z" fill="${color}"/>${strands}`;
}

type NailPattern = 'flowers' | 'blue' | 'rose-lines' | 'burgundy' | 'animal' | 'graphic' | 'french' | 'gold-dots' | 'blue-print';

function hand(pattern: NailPattern, r: Rand, x0: number, flip: boolean) {
  const base: Record<NailPattern, string> = {
    flowers: '#e8b7c0', blue: '#2f4f9a', 'rose-lines': '#e2a6ae', burgundy: '#6e1f2e', animal: '#7a2238',
    graphic: '#f1eadf', french: '#f0c9cc', 'gold-dots': '#d98ea0', 'blue-print': '#2a4fb0',
  };
  const fingers = [0, 1, 2, 3].map((i) => {
    const x = x0 + i * 13;
    const len = [40, 46, 44, 36][i]!;
    const top = 60 - len;
    const nail = `<path d="M${x + 2} ${top + 16}C${x + 2} ${top + 4} ${x + 5} ${top - 6} ${x + 6} ${top - 8}C${x + 7} ${top - 6} ${x + 10} ${top + 4} ${x + 10} ${top + 16}Z" fill="${pattern === 'graphic' && i % 2 ? C.ink : base[pattern]}" stroke="${C.goldLight}" stroke-width="0.4"/>`;
    const extra = {
      flowers: `<circle cx="${x + 6}" cy="${top + 6}" r="1.6" fill="#fff"/>`,
      'rose-lines': `<path d="M${x + 3} ${top + 10}q3 -4 6 0" stroke="${C.gold}" stroke-width="0.7" fill="none"/>`,
      'gold-dots': `<circle cx="${x + 6}" cy="${top + 4}" r="1.1" fill="${C.goldLight}"/><circle cx="${x + 6}" cy="${top + 9}" r="1.1" fill="${C.ink}"/>`,
      french: `<path d="M${x + 3.5} ${top + 1}C${x + 4.5} ${top - 4} ${x + 7.5} ${top - 4} ${x + 8.5} ${top + 1}Z" fill="#fff"/>`,
      animal: `<circle cx="${f(x + 4 + r() * 4)}" cy="${f(top + 2 + r() * 8)}" r="1.2" fill="${C.ink}"/>`,
      'blue-print': `<path d="M${x + 3.5} ${top + 1}C${x + 4.5} ${top - 4} ${x + 7.5} ${top - 4} ${x + 8.5} ${top + 1}Z" fill="#fff"/><circle cx="${x + 6}" cy="${top + 8}" r="1" fill="${C.ink}"/>`,
      graphic: `<path d="M${x + 3} ${top + 6}h6" stroke="#b5322f" stroke-width="0.8"/>`,
      blue: i === 2 ? `<circle cx="${x + 6}" cy="${top + 6}" r="1.4" fill="${C.goldLight}"/>` : '',
      burgundy: i === 1 ? `<path d="M${x + 4} ${top + 4}l2 -3l2 3z" fill="${C.goldLight}"/>` : '',
    }[pattern];
    return `<rect x="${x}" y="${top}" width="12" height="${len + 24}" rx="6" fill="url(#skinHand)" stroke="${C.gold}" stroke-width="0.5"/>${nail}${extra}`;
  }).join('');
  const thumb = `<path d="M${x0 + 50} 70C${x0 + 60} 60 ${x0 + 66} 52 ${x0 + 70} 50C${x0 + 74} 52 ${x0 + 72} 60 ${x0 + 64} 74Z" fill="url(#skinHand)" stroke="${C.gold}" stroke-width="0.5"/>`;
  const palm = `<path d="M${x0 - 2} 60H${x0 + 54}C${x0 + 56} 84 ${x0 + 50} 104 ${x0 + 40} 118H${x0 + 8}C${x0} 104 ${x0 - 4} 84 ${x0 - 2} 60Z" fill="url(#skinHand)" stroke="${C.gold}" stroke-width="0.6"/>`;
  const g = `${palm}${thumb}${fingers}`;
  return flip ? `<g transform="translate(${2 * x0 + 52} 0) scale(-1 1)">${g}</g>` : g;
}

function hands(pattern: NailPattern, count: 1 | 2, r: Rand) {
  const defs = `<defs><linearGradient id="skinHand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2c9a6"/><stop offset="1" stop-color="#a4835b"/></linearGradient></defs>`;
  return count === 1 ? `${defs}${hand(pattern, r, 24, false)}` : `${defs}<g transform="translate(-14 6) rotate(-8 30 80)">${hand(pattern, r, 0, false)}</g><g transform="translate(14 0) rotate(8 70 80)">${hand(pattern, r, 48, true)}</g>`;
}

function eyeBrow() {
  return `<path d="M8 40C30 14 70 12 94 30C70 22 32 24 8 40Z" fill="#2a1d14" stroke="${C.gold}" stroke-width="0.8"/>
  <path d="M14 66C32 48 68 48 86 66C68 80 32 80 14 66Z" fill="${C.ivory}" stroke="${C.gold}" stroke-width="1"/>
  <circle cx="50" cy="65" r="11" fill="${C.emerald}" stroke="${C.goldLight}" stroke-width="1"/><circle cx="50" cy="65" r="4.5" fill="${C.ink}"/>
  ${Array.from({ length: 9 }, (_, i) => `<path d="M${22 + i * 7} ${f(57 - Math.sin((i / 8) * Math.PI) * 6)}l${-2 + i * 0.5} -6" stroke="${C.ink}" stroke-width="0.8"/>`).join('')}
  <path d="M10 40C30 30 70 24 92 32" stroke="${C.goldLight}" stroke-width="0.5" fill="none" stroke-dasharray="1.5 2"/>`;
}

function face(variant: 'towel' | 'process' | 'device') {
  const towel = variant === 'towel'
    ? `<path d="M18 30C22 8 78 8 82 30C82 46 76 52 70 54C60 44 40 44 30 54C24 52 18 46 18 30Z" fill="#efe6d8" stroke="${C.gold}" stroke-width="0.8"/>
       ${[0, 1, 2].map((i) => `<path d="M${24 + i * 4} ${36 + i * 6}C40 ${30 + i * 6} 60 ${30 + i * 6} ${76 - i * 4} ${36 + i * 6}" stroke="${C.bronze}" stroke-width="0.5" fill="none"/>`).join('')}`
    : `<path d="M22 40C22 16 78 16 78 40Z" fill="#1a1512"/>`;
  const tool = variant === 'device'
    ? `<path d="M70 62L96 40" stroke="${C.ivory}" stroke-width="5" stroke-linecap="round"/><circle cx="68" cy="64" r="4" fill="${C.goldLight}"/>`
    : `<ellipse cx="80" cy="74" rx="14" ry="9" fill="#2b3b4f" stroke="${C.gold}" stroke-width="0.6" transform="rotate(-25 80 74)"/>`;
  return `<ellipse cx="50" cy="66" rx="30" ry="40" fill="url(#skinFace)" stroke="${C.gold}" stroke-width="1"/>
  <defs><linearGradient id="skinFace" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e6d0ae"/><stop offset="1" stop-color="#a9875d"/></linearGradient></defs>
  ${towel}<path d="M34 66q6 4 12 0M54 66q6 4 12 0" stroke="${C.ink}" stroke-width="1.2" fill="none"/>
  <path d="M48 74q2 6 -2 8" stroke="${C.bronze}" stroke-width="0.9" fill="none"/><path d="M42 90q8 4 16 0" stroke="#8a4b45" stroke-width="1.4" fill="none"/>${tool}`;
}

function hexLights(w: number, y: number, size: number) {
  const hex = (cx: number, cy: number) => `<polygon points="${[0, 1, 2, 3, 4, 5].map((i) => `${f(cx + size * Math.cos((Math.PI / 3) * i))},${f(cy + size * 0.42 * Math.sin((Math.PI / 3) * i))}`).join(' ')}" fill="none" stroke="${C.goldLight}" stroke-width="${f(size / 18)}"/>`;
  return [-1.5, 0, 1.5].map((k) => hex(w / 2 + k * size * 1.6, y)).join('') + `<rect x="0" y="${f(y - size)}" width="${w}" height="${f(size * 2)}" fill="url(#glow)" opacity="0.18"/>`;
}

function chair(x: number, y: number, s: number) {
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${s})"><rect x="-26" y="-70" width="52" height="64" rx="12" fill="${C.ink}" stroke="${C.gold}" stroke-width="1.5"/>
  <rect x="-34" y="-10" width="68" height="22" rx="8" fill="${C.ink}" stroke="${C.gold}" stroke-width="1.5"/><path d="M0 12V44M-24 50H24" stroke="#9aa3a0" stroke-width="5"/></g>`;
}

function mirror(x: number, y: number, s: number) {
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${s})"><path d="M0 -90C34 -96 46 -60 40 -20C36 20 50 60 20 86C-10 100 -44 80 -40 40C-36 0 -50 -40 -34 -70C-26 -84 -14 -88 0 -90Z" fill="#203b33" stroke="${C.goldLight}" stroke-width="3"/>
  <path d="M-10 -60C10 -66 20 -40 16 -10" stroke="${C.ivory}" stroke-opacity="0.35" stroke-width="3" fill="none"/></g>`;
}

function floor({ w, h }: Scene, y: number, color = '#5b4a3a') {
  const lines = Array.from({ length: 9 }, (_, i) => `<line x1="${f(w / 2)}" y1="${f(y)}" x2="${f(-w * 0.5 + i * w * 0.25)}" y2="${h}" stroke="${C.ink}" stroke-opacity="0.35" stroke-width="2"/>`).join('');
  return `<rect x="0" y="${f(y)}" width="${w}" height="${f(h - y)}" fill="${color}"/>${lines}`;
}

type Interior = 'barber' | 'barber-wide' | 'salon' | 'lounge' | 'manicure' | 'reception';

function interior(scene: Scene, kind: Interior) {
  const { w, h } = scene;
  const s = Math.min(w, h) / 600;
  const wall = `<rect width="${w}" height="${h}" fill="${C.emerald}"/>${Array.from({ length: 14 }, (_, i) => `<rect x="${f((i * w) / 14)}" y="0" width="${f(w / 28)}" height="${f(h * 0.7)}" fill="${C.deep}" opacity="0.35"/>`).join('')}`;
  const ground = floor(scene, h * 0.72);
  const parts: Record<Interior, string> = {
    barber: `${hexLights(w, h * 0.12, 70 * s)}${mirror(w * 0.28, h * 0.42, s * 1.1)}${mirror(w * 0.72, h * 0.42, s * 1.1)}${chair(w * 0.28, h * 0.74, s * 1.3)}${chair(w * 0.72, h * 0.74, s * 1.3)}`,
    'barber-wide': `${hexLights(w, h * 0.1, 80 * s)}${mirror(w * 0.18, h * 0.4, s)}${chair(w * 0.5, h * 0.8, s * 1.6)}<rect x="${f(w * 0.72)}" y="${f(h * 0.5)}" width="${f(120 * s)}" height="${f(70 * s)}" rx="${f(10 * s)}" fill="${C.ink}" stroke="${C.gold}" stroke-width="2"/>`,
    salon: `${mirror(w * 0.5, h * 0.4, s * 1.5)}<rect x="${f(w * 0.2)}" y="${f(h * 0.58)}" width="${f(w * 0.6)}" height="${f(h * 0.12)}" fill="${C.marble}" stroke="${C.gold}" stroke-width="2"/>${chair(w * 0.5, h * 0.86, s * 1.2)}`,
    lounge: `<rect x="${f(w * 0.12)}" y="${f(h * 0.5)}" width="${f(w * 0.76)}" height="${f(h * 0.16)}" rx="${f(24 * s)}" fill="#7d8381" stroke="${C.ink}" stroke-width="3"/>
      <rect x="${f(w * 0.1)}" y="${f(h * 0.6)}" width="${f(w * 0.8)}" height="${f(h * 0.1)}" rx="${f(18 * s)}" fill="#8c9391"/>
      <ellipse cx="${f(w * 0.5)}" cy="${f(h * 0.8)}" rx="${f(w * 0.2)}" ry="${f(h * 0.03)}" fill="url(#goldFill)"/><path d="M${f(w * 0.5)} ${f(h * 0.8)}V${f(h * 0.9)}" stroke="${C.gold}" stroke-width="${f(6 * s)}"/>
      ${[0.12, 0.88].map((x) => `<path d="M${f(w * x)} ${f(h * 0.5)}q-${f(30 * s)} -${f(80 * s)} 0 -${f(160 * s)}q${f(30 * s)} ${f(80 * s)} 0 ${f(160 * s)}" fill="#2e6b4b"/>`).join('')}`,
    manicure: `${[0.2, 0.32, 0.44].map((y) => `<rect x="${f(w * 0.08)}" y="${f(h * y)}" width="${f(w * 0.84)}" height="${f(6 * s)}" fill="${C.gold}"/>${Array.from({ length: 9 }, (_, i) => `<rect x="${f(w * (0.1 + i * 0.09))}" y="${f(h * y - 26 * s)}" width="${f(12 * s)}" height="${f(26 * s)}" rx="${f(3 * s)}" fill="${['#c1416a', '#e8b7c0', '#6e1f2e', '#f1eadf', '#2f4f9a'][i % 5]}"/>`).join('')}`).join('')}
      <rect x="${f(w * 0.15)}" y="${f(h * 0.62)}" width="${f(w * 0.7)}" height="${f(h * 0.05)}" fill="#f4f1ec" stroke="${C.gold}" stroke-width="2"/>
      <path d="M${f(w * 0.7)} ${f(h * 0.62)}V${f(h * 0.5)}q${f(-40 * s)} ${f(-20 * s)} ${f(-80 * s)} 0" stroke="${C.ivory}" stroke-width="${f(5 * s)}" fill="none"/><circle cx="${f(w * 0.7 - 80 * s)}" cy="${f(h * 0.5 + 6 * s)}" r="${f(26 * s)}" fill="url(#glow)"/>`,
    reception: `${[0.16, 0.84].map((x) => `<rect x="${f(w * x - 4 * s)}" y="0" width="${f(8 * s)}" height="${f(h * 0.72)}" fill="${C.goldLight}"/><rect x="${f(w * x - 60 * s)}" y="0" width="${f(120 * s)}" height="${f(h * 0.72)}" fill="url(#glow)" opacity="0.35"/>`).join('')}
      <rect x="${f(w * 0.28)}" y="${f(h * 0.5)}" width="${f(w * 0.44)}" height="${f(h * 0.3)}" fill="${C.marble}" stroke="${C.gold}" stroke-width="2"/>
      ${Array.from({ length: 5 }, (_, i) => `<path d="M${f(w * (0.3 + i * 0.08))} ${f(h * 0.5)}q${f(20 * s)} ${f(60 * s)} ${f(-10 * s)} ${f(h * 0.3)}" stroke="#a9a49c" stroke-width="1.5" fill="none"/>`).join('')}
      <g transform="translate(${f(w * 0.5)} ${f(h * 0.64)})"><ellipse rx="${f(70 * s)}" ry="${f(22 * s)}" fill="none" stroke="${C.gold}" stroke-width="${f(3 * s)}"/><circle r="${f(16 * s)}" fill="${C.ink}" stroke="${C.gold}" stroke-width="${f(2 * s)}"/></g>
      <rect x="${f(w * 0.36)}" y="${f(h * 0.24)}" width="${f(w * 0.28)}" height="${f(h * 0.12)}" fill="${C.ink}" stroke="#333" stroke-width="3"/>
      ${[0.1, 0.9].map((x) => `<path d="M${f(w * x)} ${f(h * 0.72)}q-${f(40 * s)} -${f(90 * s)} 0 -${f(180 * s)}q${f(40 * s)} ${f(90 * s)} 0 ${f(180 * s)}" fill="#2e6b4b"/>`).join('')}`,
  };
  return `${wall}${ground}${parts[kind]}`;
}

function facade(scene: Scene) {
  const { w, h } = scene;
  const s = Math.min(w, h) / 600;
  const bars = Array.from({ length: 40 }, (_, i) => `<rect x="${f(i * (w / 40))}" y="${f(h * 0.48)}" width="${f(4 * s)}" height="${f(h * 0.32)}" fill="${C.ink}"/>`).join('');
  const sign = (x: number, y: number, sw: number) => `<rect x="${f(x)}" y="${f(y)}" width="${f(sw)}" height="${f(sw * 0.55)}" fill="${C.ink}" stroke="#555" stroke-width="3"/>
    <g transform="translate(${f(x + sw / 2)} ${f(y + sw * 0.27)})"><ellipse rx="${f(sw * 0.22)}" ry="${f(sw * 0.07)}" fill="none" stroke="${C.gold}" stroke-width="${f(3 * s)}"/><circle r="${f(sw * 0.06)}" fill="${C.gold}"/></g>
    <circle cx="${f(x + sw * 0.2)}" cy="${f(y - 12 * s)}" r="${f(40 * s)}" fill="url(#glow)"/><circle cx="${f(x + sw * 0.8)}" cy="${f(y - 12 * s)}" r="${f(40 * s)}" fill="url(#glow)"/>`;
  const pole = `<g transform="translate(${f(w * 0.5)} ${f(h * 0.5)})"><rect x="${f(-8 * s)}" y="0" width="${f(16 * s)}" height="${f(70 * s)}" rx="${f(8 * s)}" fill="#fff"/>${[0, 1, 2, 3].map((i) => `<path d="M${f(-8 * s)} ${f(i * 18 * s)}l${f(16 * s)} ${f(10 * s)}" stroke="${i % 2 ? '#2a4fb0' : '#c0392b'}" stroke-width="${f(5 * s)}"/>`).join('')}</g>`;
  return `<rect x="${f(w * 0.05)}" y="${f(h * 0.2)}" width="${f(w * 0.9)}" height="${f(h * 0.6)}" fill="#3b3430"/>
  <rect x="${f(w * 0.3)}" y="${f(h * 0.32)}" width="${f(w * 0.4)}" height="${f(h * 0.3)}" fill="#e8dcc8" opacity="0.85"/>
  ${sign(w * 0.08, h * 0.26, w * 0.18)}${sign(w * 0.6, h * 0.22, w * 0.32)}${bars}${pole}
  <rect x="0" y="${f(h * 0.8)}" width="${w}" height="${f(h * 0.2)}" fill="#4a4540"/><rect x="0" y="${f(h * 0.74)}" width="${w}" height="${f(h * 0.06)}" fill="#6d665c"/>`;
}

// ---------------------------------------------------------------- catalogue of demo files

type Draw = (scene: Scene) => string;
interface Spec { readonly file: string; readonly w: number; readonly h: number; readonly caption: string; readonly draw: Draw }

const portrait = (box: [number, number], scale: number, body: (r: Rand) => string, dy = 0, tone?: 'emerald' | 'ink'): Draw =>
  (scene) => `${backdrop(scene, tone)}${place(scene, box, scale, body(scene.r), dy)}`;

const cutSpec = (file: string, w: number, h: number, caption: string, cut: Cut): Spec =>
  ({ file, w, h, caption, draw: portrait([100, 125], 0.82, (r) => profile(cut, r), 0.02) });
const nailSpec = (file: string, w: number, h: number, caption: string, pattern: NailPattern, count: 1 | 2): Spec =>
  ({ file, w, h, caption, draw: count === 1
    ? portrait([100, 130], 0.8, (r) => hands(pattern, count, r), 0.05, 'ink')
    : portrait([132, 130], 0.84, (r) => `<g transform="translate(16 0)">${hands(pattern, count, r)}</g>`, 0.05, 'ink') });
const hairSpec = (file: string, w: number, h: number, caption: string, color: string, style: 'waves' | 'straight'): Spec =>
  ({ file, w, h, caption, draw: portrait([100, 140], 0.86, (r) => hairBack(color, style, r), 0.03) });

/** Works: same ids and aspect ratios as the catalogue entries they stand in for. */
const works: Spec[] = [
  cutSpec('works/corte-textura.webp', 1200, 1500, 'Textura y degradado', 'texture'),
  nailSpec('works/unas-flores.webp', 720, 1280, 'Flores sobre rosa', 'flowers', 1),
  { file: 'works/cejas-definidas.webp', w: 900, h: 1125, caption: 'La mirada, en detalle', draw: portrait([100, 100], 0.8, () => eyeBrow()) },
  nailSpec('works/unas-azul.webp', 720, 1280, 'Azul y acentos dorados', 'blue', 2),
  cutSpec('works/corte-peinado.webp', 910, 1213, 'Líneas del corte', 'styled'),
  { file: 'works/facial-proceso.webp', w: 1080, h: 1440, caption: 'Limpieza facial', draw: portrait([100, 110], 0.8, () => face('process')) },
  nailSpec('works/unas-rosa.webp', 720, 1280, 'Rosa y líneas doradas', 'rose-lines', 1),
  cutSpec('works/corte-rizado.webp', 800, 854, 'Rizos y contraste', 'curly'),
  cutSpec('works/corte-barba.webp', 800, 950, 'Corte y barba', 'beard'),
  cutSpec('works/corte-linea.webp', 800, 1070, 'Una línea de carácter', 'line'),
  cutSpec('works/corte-fade-perfil.webp', 812, 1600, 'Degradado y textura', 'fade'),
  cutSpec('works/barba-trabajo.webp', 941, 1600, 'Barba con forma', 'beard'),
  nailSpec('works/unas-borgona.webp', 821, 1600, 'Borgoña y detalle dorado', 'burgundy', 1),
  hairSpec('works/peluqueria-rubio-ondas.webp', 811, 1600, 'Rubio con ondas', '#c9a768', 'waves'),
  hairSpec('works/peluqueria-liso.webp', 881, 1600, 'Largo y liso', '#3b261a', 'straight'),
  cutSpec('works/barberia-perfil-barba.webp', 1086, 1448, 'Perfil y barba', 'shaved'),
  cutSpec('works/peluqueria-rubio-texturizado.webp', 960, 1280, 'Rubio con textura', 'platinum'),
  nailSpec('works/unas-vino-animal-print.webp', 720, 1280, 'Vino y estampado', 'animal', 2),
  nailSpec('works/unas-grafico.webp', 720, 1280, 'Arte gráfico', 'graphic', 2),
  nailSpec('works/unas-francesa-flores.webp', 720, 1280, 'Francesa con flores', 'french', 2),
  { file: 'works/facial-aparatologia.webp', w: 586, h: 1021, caption: 'Cuidado de la piel', draw: portrait([100, 110], 0.84, () => face('device')) },
  nailSpec('works/unas-dorado-puntos.webp', 720, 1280, 'Detalles dorados', 'gold-dots', 1),
  nailSpec('works/unas-azul-animal-print.webp', 720, 1280, 'Azul y estampado', 'blue-print', 2),
];

/** Lighter globe variants (catalogue `thumbSource`), as the originals had for five works. */
const thumbs: Spec[] = ['corte-fade-perfil', 'barba-trabajo', 'unas-borgona', 'peluqueria-rubio-ondas', 'peluqueria-liso'].map((id) => {
  const source = works.find((spec) => spec.file === `works/${id}.webp`)!;
  const k = 960 / source.h;
  return { ...source, file: `globe/${id}-globo.webp`, w: Math.round(source.w * k), h: 960 };
});

const interiorSpec = (file: string, w: number, h: number, caption: string, kind: Interior): Spec =>
  ({ file, w, h, caption, draw: (scene) => `${backdrop(scene)}${interior(scene, kind)}` });

const spaces: Spec[] = [
  interiorSpec('spaces/estaciones.webp', 1086, 1448, 'Estaciones y espejos', 'barber'),
  interiorSpec('spaces/salon.webp', 1086, 1448, 'Un lugar para tu momento', 'salon'),
  interiorSpec('spaces/espera.webp', 1086, 1448, 'Antes de empezar', 'lounge'),
  interiorSpec('spaces/barberia-perspectiva.webp', 1122, 1402, 'Otra perspectiva', 'barber-wide'),
  interiorSpec('spaces/manicura.webp', 738, 1600, 'Área de manicura', 'manicure'),
  { file: 'spaces/fachada.webp', w: 1600, h: 900, caption: 'La fachada, de noche', draw: (scene) => `${backdrop(scene, 'night')}${facade(scene)}` },
  interiorSpec('hero/recepcion.webp', 1086, 1448, 'Recepción', 'reception'),
];

/** Video loops: frame function of t ∈ [0, 1). */
interface Clip { readonly file: string; readonly poster: string; readonly w: number; readonly h: number; readonly caption: string; readonly frame: (scene: Scene, t: number) => string }

const ringOverlay = ({ w, h }: Scene, t: number) => {
  const angle = t * 360;
  return `<g transform="translate(${f(w / 2)} ${f(h * 0.46)}) rotate(${f(angle)})"><ellipse rx="${f(w * 0.46)}" ry="${f(w * 0.14)}" fill="none" stroke="${C.goldLight}" stroke-opacity="0.55" stroke-width="${f(w / 260)}"/>
  <circle cx="${f(w * 0.46)}" cy="0" r="${f(w / 70)}" fill="${C.goldLight}"/></g>`;
};

const clips: Clip[] = [
  {
    file: 'videos/ritual-toallas-calidas.webm', poster: 'posters/ritual-toallas-calidas.webp', w: 464, h: 832, caption: 'Ritual de toallas cálidas',
    frame: (scene, t) => `${backdrop(scene)}<circle cx="${f(scene.w / 2)}" cy="${f(scene.h * 0.46)}" r="${f(scene.w * (0.42 + 0.06 * Math.sin(t * 2 * Math.PI)))}" fill="url(#glow)" opacity="0.35"/>${place(scene, [100, 110], 0.84, face('towel'))}${ringOverlay(scene, t)}`,
  },
  {
    file: 'videos/limpieza-facial.webm', poster: 'posters/limpieza-facial.webp', w: 576, h: 1024, caption: 'Limpieza facial · paso a paso',
    frame: (scene, t) => {
      const step = Math.floor(t * 3);
      const dots = [0, 1, 2].map((i) => `<circle cx="${f(scene.w / 2 + (i - 1) * 36)}" cy="${f(scene.h * 0.84)}" r="${i === step ? 9 : 5}" fill="${i === step ? C.goldLight : C.gold}" fill-opacity="${i === step ? 1 : 0.5}"/>`).join('');
      return `${backdrop(scene)}${place(scene, [100, 110], 0.8, face(step === 2 ? 'device' : 'process'), -0.04)}${dots}`;
    },
  },
];

// ---------------------------------------------------------------- render

const svg = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

async function renderWebp(spec: Spec) {
  const scene = { w: spec.w, h: spec.h, r: rng(spec.file) };
  const data = await sharp(Buffer.from(svg(spec.w, spec.h, spec.draw(scene) + label(scene, spec.caption))))
    .webp({ quality: 82, effort: 6 })
    .toBuffer();
  await save(spec.file, data);
}

const manifest: Record<string, { sha256: string; bytes: number }> = {};

async function save(file: string, data: Buffer) {
  const target = join(OUT, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
  manifest[file] = { sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length };
  console.log(`  ${relative(ROOT, target).replaceAll('\\', '/')} (${Math.round(data.length / 1024)} KB)`);
}

async function encodeClip(clip: Clip, ffmpeg: string) {
  const FPS = 24;
  const FRAMES = FPS * 6;
  const target = join(OUT, clip.file);
  await mkdir(dirname(target), { recursive: true });
  const child = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0',
    '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38', '-pix_fmt', 'yuv420p', '-an', target], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise<void>((resolve, reject) => child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
  for (let i = 0; i < FRAMES; i++) {
    const scene = { w: clip.w, h: clip.h, r: rng(clip.file) };
    const frame = await sharp(Buffer.from(svg(clip.w, clip.h, clip.frame(scene, i / FRAMES) + label(scene, clip.caption)))).jpeg({ quality: 90 }).toBuffer();
    if (!child.stdin.write(frame)) await new Promise((resolve) => child.stdin.once('drain', resolve));
  }
  child.stdin.end();
  await done;
  const data = await readFile(target);
  manifest[clip.file] = { sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length };
  console.log(`  ${relative(ROOT, target).replaceAll('\\', '/')} (${Math.round(data.length / 1024)} KB)`);
}

console.log('Generating demo media in src/assets/demo');
for (const spec of [...works, ...thumbs, ...spaces]) await renderWebp(spec);
for (const clip of clips) {
  await renderWebp({ file: clip.poster, w: clip.w, h: clip.h, caption: clip.caption, draw: (scene) => clip.frame(scene, 0) });
}

const ffmpeg = process.env.FFMPEG_PATH?.trim();
const previous = await readFile(join(OUT, 'manifest.json'), 'utf8').then((text) => JSON.parse(text).files as typeof manifest).catch(() => ({} as typeof manifest));
for (const clip of clips) {
  if (ffmpeg) await encodeClip(clip, ffmpeg);
  else if (previous[clip.file]) { manifest[clip.file] = previous[clip.file]!; console.log(`  ${clip.file} kept (set FFMPEG_PATH to re-encode)`); }
  else console.warn(`  ${clip.file} skipped: set FFMPEG_PATH to an ffmpeg with libvpx-vp9`);
}

const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(join(OUT, 'manifest.json'), `${JSON.stringify({
  generator: 'scripts/generate-demo-media.ts',
  provenance: 'Procedurally generated vector illustrations. No photography, client imagery, logos or third-party material.',
  files: sorted,
}, null, 2)}\n`);
console.log(`Done: ${Object.keys(sorted).length} files, manifest.json updated.`);
