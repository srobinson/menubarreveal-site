// The art step: npm run art. Run it when a picture changes and commit what it writes; a deploy never runs it.
//   1. Each picture gets the bytes it is served as. If its entry names a master and the master is on disk, Eleventy
//      Image encodes them from it. Else a plain named file put into assets/art/ (already optimised) is taken as it
//      is. Else the committed file stays.
//   2. The file is named with a digest of its bytes (plate.0123456789abcdef.webp), so a changed picture has a new
//      address and /assets/ can be cached for a year. The file it replaces is removed.
//   3. A 24 px WebP of each picture goes into the page itself as a data URL: the preview the browser shows under
//      the picture until the picture has loaded. The page needs no script for it.
//   4. index.html is rewritten in two places only: the custom properties between the art marks in the :root rule
//      (--name and --name-preview for each picture) and any other mention of a picture's file, such as an <img src>.
// `npm run art` then runs tools/csp.mjs --write, because the <style> block changed.
import Image from '@11ty/eleventy-img';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './site.mjs';

const DIR = 'assets/art';
// name: the custom properties, --name and --name-preview. files: plain names; two files make an image-set, 1x and 2x.
// To have a picture encoded here, add master (a lossless file, not committed), widths (one per file) and encode
// (Eleventy Image options, such as { sharpAvifOptions: { quality: 50 } }).
// The wall: Sharp's AVIF at quality 50, from the masters that tools/mural/art.sh paints.
const MURAL = { sharpAvifOptions: { quality: 50, effort: 4 } };
const PICTURES = [
  { name: 'mural-phone', files: ['mural-strip-692.avif', 'mural-strip-1384.avif'], master: 'tools/mural/masters/mural-strip-1384.png', widths: [692, 1384], encode: MURAL },
  { name: 'mural-wide', files: ['mural-sun450-1440.avif', 'mural-sun450-2880.avif'], master: 'tools/mural/masters/mural-sun450-2880.png', widths: [1440, 2880], encode: MURAL },
  { name: 'relief', files: ['wall-relief.webp'] },
  { name: 'plate', files: ['plate.webp'] },
  { name: 'crease', files: ['crease-flyer.webp'] },
  { name: 'grime', files: ['grime.webp'] },
  { name: 'ply', files: ['ply-halftone.webp'] },
];
const PREVIEW = { widths: [24], formats: ['webp'], sharpWebpOptions: { quality: 50 }, dryRun: true };
const START = '/* art:start';
const END = '/* art:end */';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const parts = (file) => [file.slice(0, file.lastIndexOf('.')), file.slice(file.lastIndexOf('.') + 1)];
// a picture's file, with or without a digest in its name
const mention = (file, digestPart = '(?:\\.[0-9a-f]{16})?') => {
  const [stem, ext] = parts(file).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return `${stem}${digestPart}\\.${ext}`;
};
const committed = (file) => readdirSync(join(root, DIR)).filter((name) => new RegExp(`^${mention(file, '\\.[0-9a-f]{16}')}$`).test(name));

// The bytes each file of a picture is served as: encoded from the master, or taken as they are.
const bytesOf = async (picture) => {
  if (picture.master && existsSync(join(root, picture.master))) {
    const format = parts(picture.files[0])[1];
    const made = (await Image(join(root, picture.master), { widths: picture.widths, formats: [format], dryRun: true, ...picture.encode }))[format];
    if (made.length !== picture.files.length) throw new Error(`${picture.name}: the master gave ${made.length} widths, not ${picture.files.length}`);
    return picture.widths.map((width) => made.find((variant) => variant.width === width).buffer);
  }
  return picture.files.map((file) => {
    const found = existsSync(join(root, DIR, file)) ? [file] : committed(file);
    if (found.length !== 1) throw new Error(`${DIR}/${file}: expected one file to serve, found ${found.length}. Put the optimised picture there under its plain name.`);
    return readFileSync(join(root, DIR, found[0]));
  });
};

let page = readFileSync(join(root, 'index.html'), 'utf8');
const properties = [];
for (const picture of PICTURES) {
  const bytes = await bytesOf(picture);
  const names = picture.files.map((file, i) => {
    const [stem, ext] = parts(file);
    const name = `${stem}.${digest(bytes[i])}.${ext}`;
    for (const old of [file, ...committed(file)]) if (old !== name) rmSync(join(root, DIR, old), { force: true });
    if (!existsSync(join(root, DIR, name))) writeFileSync(join(root, DIR, name), bytes[i]);
    page = page.replace(new RegExp(`${DIR}/${mention(file)}`, 'g'), `${DIR}/${name}`);
    console.log(`${name}  ${bytes[i].length} B`);
    return name;
  });
  const preview = (await Image(bytes[0], PREVIEW)).webp[0];
  const full = names.length === 1 ? `url(${DIR}/${names[0]})` : `image-set(${names.map((name, i) => `url(${DIR}/${name}) ${i + 1}x`).join(', ')})`;
  properties.push(`  --${picture.name}: ${full};`, `  --${picture.name}-preview: url(data:image/webp;base64,${preview.buffer.toString('base64')});`);
  console.log(`  --${picture.name}-preview  ${preview.width}x${preview.height}, ${preview.size} B`);
}

const from = page.indexOf(START);
const to = page.indexOf(END);
if (from < 0 || to < from) throw new Error(`index.html: the :root rule needs the marks "${START} ... */" and "${END}"`);
const startMark = page.slice(from, page.indexOf('*/', from) + 2);
page = `${page.slice(0, from)}${startMark}\n${properties.join('\n')}\n  ${page.slice(to)}`;
writeFileSync(join(root, 'index.html'), page);
