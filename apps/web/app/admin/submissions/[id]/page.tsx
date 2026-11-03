import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { DualScreenPreview } from '@/components/DualScreenPreview';
import { ModerationActions } from '@/components/ModerationActions';
import type { Draft } from '@/components/submit/types';
import { PUBLIC_API_URL, type Mod, type Submission } from '@/lib/api';
import { apiJson, getMe, isModerator } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Review submission' };

type Detail = Submission & {
  payload: Partial<Draft>;
  user: { id: string; display_name: string };
  current: Mod | null;
  problems: string[];
};

const img = (sha: string) => `${PUBLIC_API_URL.replace(/\/$/, '')}/media/${sha}.webp`;

/** Flattens a payload into "path: value" lines for a simple before/after comparison. */
function lines(v: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) for (const [p, s] of lines(x, prefix ? `${prefix}.${k}` : k)) out.set(p, s);
  } else if (prefix) out.set(prefix, String(v));
  return out;
}

export default async function Review({ params }: { params: Promise<{ id: string }> }) {
  const me = await getMe();
  const { id } = await params;
  if (!me) redirect(`/login?next=/admin/submissions/${id}`);
  if (!isModerator(me)) notFound();
  const d = await apiJson<Detail>(`/v1/admin/submissions/${encodeURIComponent(id)}`);
  if (!d) notFound();
  const t = await getTranslations('admin');
  const p = d.payload;
  const pairs = (p.screens?.pairs ?? []).filter((x) => x.top && x.bottom);
  const previews = pairs.map((x) => ({
    top: { url: img(x.top!), width: null, height: null, source: 'upload', caption: null },
    bottom: { url: img(x.bottom!), width: null, height: null, source: 'upload', caption: null },
    caption: x.caption ?? null,
  }));
  // For edits: compare with the previous approved payload the API stored as `current`
  const before = d.current ? lines({ mod: { name: d.current.name, summary: d.current.summary, description: d.current.description, license: d.current.license } }) : null;
  const after = lines({ mod: { name: p.mod?.name, summary: p.mod?.summary, description: p.mod?.description, license: p.mod?.license } });
  const changed = before ? [...after].filter(([k, v]) => before.get(k) !== v) : [];

  return (
    <article className="doc doc-wide">
      <nav className="crumbs">
        <Link href="/admin">{t('title')}</Link>
      </nav>
      <header className="page-head page-head-doc">
        <h1>{p.mod?.name}</h1>
        <p className="muted">
          {t('by', { user: d.user.display_name })} · {d.mod_id ? t('edit') : t('new')}
        </p>
      </header>
      {d.problems.length ? (
        <ul className="problems">
          {d.problems.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : null}
      <div className="item-layout">
        <div className="item-main">
          {previews.length ? (
            <section className="sheet">
              <DualScreenPreview previews={previews} />
            </section>
          ) : null}
          <section className="sheet">
            <h2>{t('details')}</h2>
            <p>{p.mod?.summary}</p>
            {p.mod?.description ? <p className="prose">{p.mod.description}</p> : null}
            {changed.length ? (
              <ul className="kv">
                {changed.map(([k, v]) => (
                  <li key={k}>
                    <span>{k}</span>
                    <code>{before?.get(k) ?? '—'}</code> → <code>{v}</code>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          <section className="sheet">
            <h2>{t('raw')}</h2>
            <pre className="code code-block">
              <code>{JSON.stringify(p, null, 2)}</code>
            </pre>
          </section>
        </div>
        <aside className="item-side">
          {d.status === 'pending' ? <ModerationActions id={d.id} userId={d.user.id} modId={d.mod_id} /> : <p className="notice">{d.status}</p>}
        </aside>
      </div>
    </article>
  );
}
