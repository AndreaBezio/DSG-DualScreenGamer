import { describe, expect, it } from 'vitest';
import {
  autoCandidates,
  buildAutoMedia,
  extractImages,
  isUnwantedImage,
  manifestMedia,
  pairByName,
  readSize,
  resolveImageUrl,
} from '../src/media.ts';
import { pngHead } from './fixtures.ts';

const README = 'https://raw.githubusercontent.com/o/r/main/docs/README.md';

describe('extractImages', () => {
  it('finds markdown, html and pasted attachment images', () => {
    const text = [
      '![shot](img/a.png "title")',
      '<p><img width="300" src="https://x.test/b.jpg" alt="B"></p>',
      'https://github.com/user-attachments/assets/1234-abcd',
      'text with https://github.com/user-attachments/assets/inline not alone',
    ].join('\n');
    expect(extractImages(text)).toEqual([
      { url: 'img/a.png', alt: 'shot' },
      { url: 'https://x.test/b.jpg', alt: 'B' },
      { url: 'https://github.com/user-attachments/assets/1234-abcd' },
    ]);
  });
});

describe('resolveImageUrl', () => {
  it('resolves relative paths against the document and the repo root', () => {
    expect(resolveImageUrl('img/a.png', README)).toBe('https://raw.githubusercontent.com/o/r/main/docs/img/a.png');
    expect(resolveImageUrl('../a.png', README)).toBe('https://raw.githubusercontent.com/o/r/main/a.png');
    expect(resolveImageUrl('/media/a.png', README)).toBe('https://raw.githubusercontent.com/o/r/main/media/a.png');
  });

  it('turns blob links into raw files and ignores anchors', () => {
    expect(resolveImageUrl('https://github.com/o/r/blob/dev/x.png?raw=true', README)).toBe(
      'https://raw.githubusercontent.com/o/r/dev/x.png',
    );
    expect(resolveImageUrl('#top', README)).toBeNull();
    expect(resolveImageUrl('a.png', null)).toBeNull();
  });
});

describe('isUnwantedImage', () => {
  it.each([
    ['https://img.shields.io/badge/x-y-green', true],
    ['https://github.com/o/r/actions/workflows/ci.yml/badge.svg', true],
    ['https://raw.githubusercontent.com/o/r/main/diagram.svg', true],
    ['https://example.org/page', true],
    ['https://raw.githubusercontent.com/o/r/main/shot.PNG', false],
    ['https://github.com/user-attachments/assets/1234', false],
  ])('%s -> %s', (url, unwanted) => {
    expect(isUnwantedImage(url)).toBe(unwanted);
  });
});

describe('pairByName', () => {
  it('pairs top/bottom shots sharing a prefix', () => {
    const items = ['map_top.png', 'menu.png', 'map-bottom.png', 'title-upper.jpg', 'title-lower.jpg', 'other-top.png'].map(
      (n) => ({ url: `https://x.test/${n}` }),
    );
    const { pairs, rest } = pairByName(items);
    expect(pairs.map(([t, b]) => [t.url.split('/').pop(), b.url.split('/').pop()])).toEqual([
      ['map_top.png', 'map-bottom.png'],
      ['title-upper.jpg', 'title-lower.jpg'],
    ]);
    expect(rest.map((r) => r.url.split('/').pop())).toEqual(['menu.png', 'other-top.png']);
  });
});

describe('media rows', () => {
  it('reads PNG sizes from the first bytes', () => {
    expect(readSize(pngHead(400, 240))).toEqual({ width: 400, height: 240 });
    expect(readSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('puts manifest previews first and resolves repo paths', () => {
    const rows = manifestMedia({
      source: { github: 'o/r', assets: [], prereleases: false, auto_media: true },
      previews: [{ top: 'shots/top.png', bottom: 'https://x.test/b.png', caption: 'Map' }],
      screenshots: ['shots/g.png'],
    });
    expect(rows.map((r) => [r.kind, r.pair, r.url])).toEqual([
      ['top', 0, 'https://raw.githubusercontent.com/o/r/HEAD/shots/top.png'],
      ['bottom', 0, 'https://x.test/b.png'],
      ['gallery', null, 'https://raw.githubusercontent.com/o/r/HEAD/shots/g.png'],
    ]);
  });

  it('dedupes, drops small images and pairs automatic shots', async () => {
    const candidates = autoCandidates({
      releaseNotes: '![a](https://x.test/a-top.png) ![dup](https://x.test/a-top.png)',
      releaseNotesBase: null,
      readme: [{ url: 'https://x.test/a-bottom.png' }, { url: 'https://x.test/logo.png' }, { url: 'https://x.test/known.png' }],
      assets: [{ name: 'gallery.jpg', browser_download_url: 'https://x.test/gallery.jpg' }, { name: 'mod.zip', browser_download_url: 'https://x.test/mod.zip' }],
      exclude: ['https://x.test/known.png'],
    });
    expect(candidates.map((c) => c.url.split('/').pop())).toEqual(['a-top.png', 'a-bottom.png', 'logo.png', 'gallery.jpg']);
    const sizes: Record<string, [number, number]> = { 'a-top.png': [800, 450], 'a-bottom.png': [620, 540], 'logo.png': [96, 96], 'gallery.jpg': [1024, 768] };
    const rows = await buildAutoMedia(candidates, async (u) => pngHead(...sizes[u.split('/').pop()!]!), 1000, 1000);
    expect(rows.map((r) => [r.kind, r.pair, r.url.split('/').pop(), r.width])).toEqual([
      ['top', 1000, 'a-top.png', 800],
      ['bottom', 1000, 'a-bottom.png', 620],
      ['gallery', null, 'gallery.jpg', 1024],
    ]);
  });
});
