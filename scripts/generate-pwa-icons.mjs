import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const src = path.join(root, 'public/icons/icon-master.svg');
const faviconSrc = path.join(root, 'public/icons/icon-favicon-master.svg');

const targets = [
  { file: 'public/icons/icon-192.png', size: 192, src },
  { file: 'public/icons/icon-512.png', size: 512, src },
  { file: 'public/icons/icon-maskable-512.png', size: 512, src },
  { file: 'public/icons/apple-touch-icon.png', size: 180, src },
  // Small favicon sizes use a simplified variant - the detailed chip glyph
  // turns to mush below ~48px, so favicon-32/16 drop the pins/border and
  // just keep the bold gradient square + bolt.
  { file: 'public/icons/favicon-32.png', size: 32, src: faviconSrc },
  { file: 'public/icons/favicon-16.png', size: 16, src: faviconSrc },
];

for (const t of targets) {
  const out = path.join(root, t.file);
  await sharp(t.src, { density: 384 }).resize(t.size, t.size).png().toFile(out);
  console.log(`wrote ${t.file} (${t.size}x${t.size})`);
}
