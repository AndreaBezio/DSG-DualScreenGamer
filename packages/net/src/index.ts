// Guards for fetching URLs that users chose (file links, README images, webhooks):
// only public HTTPS hosts, checked again on every redirect hop.
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['64:ff9b::', 96],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/** Loopback, private, link-local, CGNAT, documentation, multicast and reserved ranges. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return blocked.check(ip, 'ipv4');
  if (v === 6) {
    // IPv4-mapped (::ffff:10.0.0.1) is judged by its IPv4 part
    const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? blocked.check(mapped[1]!, 'ipv4') : blocked.check(ip, 'ipv6');
  }
  return true;
}

export type Resolver = (host: string) => Promise<string[]>;
const systemResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Quick check without DNS: https, and not a literal private address or localhost. */
export function looksPublic(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  return !isIP(host) || !isPrivateAddress(host);
}

/** True when the URL is https and every address its host resolves to is public. */
export async function isPublicUrl(url: string, resolve: Resolver = systemResolver): Promise<boolean> {
  if (!looksPublic(url)) return false;
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return true;
  try {
    const addresses = await resolve(host);
    return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a));
  } catch {
    return false;
  }
}

export type UrlGuard = (url: string) => Promise<boolean>;

/** fetch() that follows redirects itself so each hop passes the guard. */
export async function guardedFetch(
  url: string,
  init: RequestInit,
  opts: { guard?: UrlGuard; fetch?: typeof fetch; maxRedirects?: number } = {},
): Promise<Response> {
  const guard = opts.guard ?? ((u) => isPublicUrl(u));
  const fetchImpl = opts.fetch ?? fetch;
  let current = url;
  for (let hop = 0; hop <= (opts.maxRedirects ?? 5); hop++) {
    if (!(await guard(current))) throw new Error(`refusing to fetch non-public URL ${new URL(current).host}`);
    const res = await fetchImpl(current, { ...init, redirect: 'manual' });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return res;
    await res.body?.cancel().catch(() => {});
    current = new URL(location, current).toString();
  }
  throw new Error('too many redirects');
}
