// Screenshot uploads: validated and re-encoded with sharp, stored as WebP named by content hash.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { uploads, type Db } from '@dsg/db';
import { and, eq, gt, sql } from 'drizzle-orm';
import sharp, { type Metadata } from 'sharp';

export const MIN_WIDTH = 320;
export const MIN_HEIGHT = 180;
const MAX_PIXELS = 40_000_000;
const PER_HOUR = 60;
const ACCEPTED = new Set(['png', 'jpeg', 'webp']);

export type UploadResult = { sha256: string; width: number; height: number; bytes: number };

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 | 415 | 429 = 400,
  ) {
    super(message);
  }
}

/**
 * Decodes, rotates by EXIF orientation, drops all metadata and re-encodes as WebP:
 * lossless for PNG (keeps pixel art crisp), quality 90 otherwise. Also writes a 640px thumbnail.
 */
export async function processImage(input: Buffer, dir: string): Promise<UploadResult> {
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    throw new UploadError('not a readable image', 415);
  }
  if (!meta.format || !ACCEPTED.has(meta.format)) throw new UploadError('use PNG, JPEG or WebP', 415);
  // EXIF orientation 5-8 swaps width and height
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = (rotated ? meta.height : meta.width) ?? 0;
  const height = (rotated ? meta.width : meta.height) ?? 0;
  if (width < MIN_WIDTH || height < MIN_HEIGHT) throw new UploadError(`image must be at least ${MIN_WIDTH}x${MIN_HEIGHT}`);

  const base = sharp(input, { limitInputPixels: MAX_PIXELS, animated: false }).rotate();
  const out = await base
    .clone()
    .webp(meta.format === 'png' ? { lossless: true, effort: 4 } : { quality: 90 })
    .toBuffer();
  const sha256 = createHash('sha256').update(out).digest('hex');
  const thumb = await base.clone().resize({ width: 640, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${sha256}.webp`), out);
  await writeFile(join(dir, `${sha256}.thumb.webp`), thumb);
  return { sha256, width, height, bytes: out.length };
}

export async function storeUpload(db: Db, userId: string, file: File, dir: string, maxBytes: number): Promise<UploadResult> {
  if (file.size > maxBytes) throw new UploadError(`image larger than ${Math.round(maxBytes / 1048576)} MB`, 413);
  const [{ n }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(uploads)
    .where(and(eq(uploads.userId, userId), gt(uploads.createdAt, new Date(Date.now() - 3_600_000))))) as [{ n: number }];
  if (n >= PER_HOUR) throw new UploadError('too many uploads, try again in an hour', 429);
  const result = await processImage(Buffer.from(await file.arrayBuffer()), dir);
  await db
    .insert(uploads)
    .values({ sha256: result.sha256, userId, width: result.width, height: result.height, bytes: result.bytes })
    .onConflictDoNothing();
  return result;
}

const FILE_RE = /^([0-9a-f]{64})(\.thumb)?\.webp$/;

export async function readMedia(dir: string, name: string): Promise<Buffer | null> {
  if (!FILE_RE.test(name)) return null;
  try {
    return await readFile(join(dir, name));
  } catch {
    return null;
  }
}

export function mediaUrl(publicUrl: string, sha256: string, thumb = false): string {
  return `${publicUrl.replace(/\/$/, '')}/media/${sha256}${thumb ? '.thumb' : ''}.webp`;
}
