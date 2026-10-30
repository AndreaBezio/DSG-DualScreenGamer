import { Icon } from './Icon';

/** Deterministic hue from an id, so tiles without art still look distinct. */
export function hueFor(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function TileArt({ id, type, cover, title }: { id: string; type: string; cover?: string | null; title: string }) {
  if (cover) return <img src={cover} alt="" className="tile-art" loading="lazy" />;
  const hue = hueFor(id);
  return (
    <span className="tile-art tile-art-gen" style={{ ['--h' as string]: hue }} aria-hidden>
      <Icon name={type} size={30} />
      <span className="tile-initials">{title.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('')}</span>
    </span>
  );
}
