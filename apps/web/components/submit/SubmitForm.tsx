'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DualScreenPreview } from '@/components/DualScreenPreview';
import { Icon } from '@/components/Icon';
import type { Preview } from '@/lib/api';
import { hashRom, type RomHashes } from '@/lib/romhash';
import {
  clean,
  ID_KINDS,
  LICENSES,
  MOD_TYPES,
  PATH_VARS,
  regionFromDat,
  ROLES,
  titleFromDatName,
  withDefaults,
  type Draft,
  type Ident,
  type PairDraft,
  type StepDraft,
} from './types';

type Option = { id: string; name: string };
type EmulatorOption = Option & { platforms: string[] };
type GameHit = { id: string; title: string; platforms: string[]; identifiers: { kind: string; value: string; region: string | null; source: string }[] };

export type SubmitFormProps = {
  id: string | null;
  status: string;
  reviewNote: string | null;
  initial: unknown;
  editingModId: string | null;
  me: { display_name: string };
  platforms: Option[];
  emulators: EmulatorOption[];
  devices: Option[];
  apiUrl: string;
};

const STEPS = ['game', 'mod', 'compat', 'screens', 'download', 'install', 'review'] as const;
type Step = (typeof STEPS)[number];

const media = (apiUrl: string, sha: string, thumb = false) => `${apiUrl.replace(/\/$/, '')}/media/${sha}${thumb ? '.thumb' : ''}.webp`;

async function bff(path: string, init: RequestInit = {}) {
  const res = await fetch(`/bff/${path}`, {
    ...init,
    headers: init.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json' } : undefined,
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

export function SubmitForm(props: SubmitFormProps) {
  const t = useTranslations('form');
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => withDefaults(props.initial, props.me));
  const [id, setId] = useState(props.id);
  const [status, setStatus] = useState(props.status);
  const [step, setStep] = useState<Step>('game');
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [problems, setProblems] = useState<string[] | null>(null);
  const [dims, setDims] = useState<Record<string, { w: number; h: number }>>({});
  const [game, setGame] = useState<GameHit | null>(null);
  const dirty = useRef(false);
  const readOnly = status === 'pending' || status === 'approved';

  const update = useCallback((fn: (d: Draft) => Draft) => {
    dirty.current = true;
    setDraft((d) => fn(structuredClone(d)));
  }, []);

  const save = useCallback(async () => {
    if (readOnly) return;
    setSaving('saving');
    const payload = clean(draft);
    const r = id
      ? await bff(`me/submissions/${id}`, { method: 'PATCH', body: JSON.stringify({ payload }) })
      : await bff('me/submissions', { method: 'POST', body: JSON.stringify({ payload, mod_id: props.editingModId ?? undefined }) });
    if (!r.ok) return setSaving('error');
    dirty.current = false;
    setSaving('saved');
    if (!id) {
      setId(r.body.id);
      window.history.replaceState(null, '', `/submit/${r.body.id}`);
    }
    setStatus(r.body.status);
    return r.body.id as string;
  }, [draft, id, readOnly, props.editingModId]);

  // Autosave a moment after the last change
  useEffect(() => {
    if (!dirty.current || readOnly) return;
    const timer = setTimeout(() => void save(), 1500);
    return () => clearTimeout(timer);
  }, [draft, save, readOnly]);

  // Load the chosen existing game (platforms and dumps drive the compatibility step)
  const existingId = 'existing' in draft.game ? draft.game.existing : null;
  useEffect(() => {
    if (!existingId) return setGame(null);
    fetch(`${props.apiUrl}/v1/games/${encodeURIComponent(existingId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setGame)
      .catch(() => setGame(null));
  }, [existingId, props.apiUrl]);

  const gamePlatforms = 'new' in draft.game ? draft.game.new.platforms : (game?.platforms ?? []);
  const gameDumps: Ident[] =
    'new' in draft.game
      ? draft.game.new.identifiers.filter((i) => i.value)
      : (game?.identifiers ?? []).filter((i) => i.source === 'manifest').map((i) => ({ kind: i.kind, value: i.value, region: i.region ?? undefined }));
  const roles = draft.download.kind === 'github' ? draft.download.assets.map((a) => a.role) : draft.download.files.map((f) => f.role);

  async function check() {
    const savedId = dirty.current || !id ? await save() : id;
    if (!savedId) return;
    const r = await bff(`me/submissions/${savedId}/check`, { method: 'POST' });
    setProblems(r.body?.errors ?? [t('unknownError')]);
  }

  async function submit() {
    const savedId = dirty.current || !id ? await save() : id;
    if (!savedId) return;
    const r = await bff(`me/submissions/${savedId}/submit`, { method: 'POST' });
    if (!r.ok) return setProblems(r.body?.errors ?? [r.body?.error ?? t('unknownError')]);
    setStatus('pending');
    setProblems([]);
    router.refresh();
  }

  const stepIndex = STEPS.indexOf(step);

  return (
    <div className="form-shell">
      {status === 'changes_requested' || status === 'rejected' ? (
        <div className={`notice ${status === 'rejected' ? 'notice-bad' : 'notice-warn'}`}>
          <strong>{t(`status.${status}`)}</strong>
          {props.reviewNote ? <p>{props.reviewNote}</p> : null}
        </div>
      ) : null}
      {readOnly ? <div className="notice notice-ok">{t(`status.${status}`)}</div> : null}

      <nav className="stepper" aria-label={t('steps')}>
        {STEPS.map((s, i) => (
          <button key={s} type="button" className={`step-pill${s === step ? ' on' : ''}${i < stepIndex ? ' done' : ''}`} onClick={() => setStep(s)} data-nav>
            <span className="step-num">{i + 1}</span>
            {t(`step.${s}`)}
          </button>
        ))}
      </nav>

      <fieldset className="sheet form-sheet" disabled={readOnly}>
        {step === 'game' ? <GameStep draft={draft} update={update} platforms={props.platforms} apiUrl={props.apiUrl} game={game} /> : null}
        {step === 'mod' ? <ModStep draft={draft} update={update} /> : null}
        {step === 'compat' ? (
          <CompatStep draft={draft} update={update} gamePlatforms={gamePlatforms} dumps={gameDumps} platforms={props.platforms} emulators={props.emulators} devices={props.devices} />
        ) : null}
        {step === 'screens' ? <ScreensStep draft={draft} update={update} apiUrl={props.apiUrl} dims={dims} setDims={setDims} /> : null}
        {step === 'download' ? <DownloadStep draft={draft} update={update} /> : null}
        {step === 'install' ? <InstallStep draft={draft} update={update} roles={roles} /> : null}
        {step === 'review' ? (
          <div className="form-grid">
            <h2>{t('step.review')}</h2>
            <label className="check">
              <input type="checkbox" checked={draft.consent.rights} onChange={(e) => update((d) => ({ ...d, consent: { ...d.consent, rights: e.target.checked } }))} />
              {t('consentRights')}
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.consent.no_game_files}
                onChange={(e) => update((d) => ({ ...d, consent: { ...d.consent, no_game_files: e.target.checked } }))}
              />
              {t('consentFiles')}
            </label>
            <div className="row-actions">
              <button type="button" className="btn btn-ghost" onClick={check} data-nav>
                {t('check')}
              </button>
              <button type="button" className="btn btn-primary" onClick={submit} data-nav>
                <Icon name="check" size={16} />
                {t('submit')}
              </button>
            </div>
            {problems ? (
              problems.length ? (
                <ul className="problems">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : (
                <p className="notice notice-ok">{status === 'pending' ? t('submitted') : t('allGood')}</p>
              )
            ) : null}
          </div>
        ) : null}
      </fieldset>

      <footer className="form-footer">
        <button type="button" className="btn btn-ghost" disabled={stepIndex === 0} onClick={() => setStep(STEPS[stepIndex - 1]!)} data-nav>
          <Icon name="back" size={16} />
          {t('back')}
        </button>
        <span className="muted save-state">{readOnly ? '' : t(`save.${saving}`)}</span>
        {stepIndex < STEPS.length - 1 ? (
          <button type="button" className="btn btn-primary" onClick={() => setStep(STEPS[stepIndex + 1]!)} data-nav>
            {t('next')}
            <Icon name="next" size={16} />
          </button>
        ) : (
          <span />
        )}
      </footer>
    </div>
  );
}

type StepProps = { draft: Draft; update: (fn: (d: Draft) => Draft) => void };

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

/* ---------- 1. Game ---------- */

function GameStep({ draft, update, platforms, apiUrl, game }: StepProps & { platforms: Option[]; apiUrl: string; game: GameHit | null }) {
  const t = useTranslations('form');
  const isNew = 'new' in draft.game;
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<GameHit[]>([]);
  const [rom, setRom] = useState<{ progress: number; hashes?: RomHashes; known?: { id: string; title: string } | null; dat?: { name: string; region: string | null; serial: string | null } | null } | null>(null);
  const romPlatform = isNew ? (draft.game as { new: { platforms: string[] } }).new.platforms[0] : game?.platforms[0];

  useEffect(() => {
    if (query.trim().length < 2) return setHits([]);
    const timer = setTimeout(() => {
      fetch(`${apiUrl}/v1/games?q=${encodeURIComponent(query)}&limit=8`)
        .then((r) => r.json())
        .then((b) => setHits(b.items ?? []))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, apiUrl]);

  async function pickRom(file: File) {
    setRom({ progress: 0 });
    const hashes = await hashRom(file, (p) => setRom({ progress: p }));
    const qs = new URLSearchParams({ sha1: hashes.sha1, md5: hashes.md5, crc32: hashes.crc32, ...(romPlatform ? { platform: romPlatform } : {}) });
    const info = await bff(`me/rom-info?${qs}`);
    setRom({ progress: 1, hashes, known: info.body?.game ?? null, dat: info.body?.dat ?? null });
  }

  function addRomIdentifiers() {
    if (!rom?.hashes) return;
    const region = regionFromDat(rom.dat?.region);
    update((d) => {
      if (!('new' in d.game)) return d;
      const g = d.game.new;
      const add = (i: Ident) => {
        if (!g.identifiers.some((x) => x.kind === i.kind && x.value.toLowerCase() === i.value.toLowerCase())) g.identifiers.push(i);
      };
      add({ kind: 'sha1', value: rom.hashes!.sha1, platform: g.platforms[0], region });
      if (rom.dat?.serial) add({ kind: 'serial', value: rom.dat.serial, platform: g.platforms[0], region });
      if (!g.title && rom.dat) g.title = titleFromDatName(rom.dat.name);
      g.identifiers = g.identifiers.filter((i) => i.value);
      return d;
    });
  }

  return (
    <div className="form-grid">
      <h2>{t('step.game')}</h2>
      <div className="segmented-tabs">
        <button type="button" className={!isNew ? 'on' : ''} onClick={() => update((d) => ({ ...d, game: { existing: game?.id ?? '' } }))}>
          {t('gameExisting')}
        </button>
        <button type="button" className={isNew ? 'on' : ''} onClick={() => update((d) => ({ ...d, game: { new: { title: '', platforms: [], identifiers: [] } } }))}>
          {t('gameNew')}
        </button>
      </div>

      {!isNew ? (
        <>
          <Field label={t('gameSearch')}>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('gameSearchPlaceholder')} />
          </Field>
          {hits.length ? (
            <ul className="pick-list">
              {hits.map((g) => (
                <li key={g.id}>
                  <button type="button" className={game?.id === g.id ? 'on' : ''} onClick={() => update((d) => ({ ...d, game: { existing: g.id } }))}>
                    <strong>{g.title}</strong> <span className="muted">{g.platforms.join(', ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {game ? <p className="notice notice-ok">{t('gameChosen', { title: game.title })}</p> : null}
        </>
      ) : (
        <>
          <Field label={t('gameTitle')}>
            <input
              value={(draft.game as { new: { title: string } }).new.title}
              maxLength={160}
              onChange={(e) => update((d) => ('new' in d.game ? (d.game.new.title = e.target.value, d) : d))}
            />
          </Field>
          <Field label={t('gamePlatform')}>
            <select
              value={(draft.game as { new: { platforms: string[] } }).new.platforms[0] ?? ''}
              onChange={(e) => update((d) => ('new' in d.game ? ((d.game.new.platforms = e.target.value ? [e.target.value] : []), d) : d))}
            >
              <option value="">—</option>
              {platforms.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <IdentifierList draft={draft} update={update} />
        </>
      )}

      <div className="rom-box">
        <strong>{t('romTitle')}</strong>
        <p className="fineprint">{t('romHint')}</p>
        <input type="file" onChange={(e) => e.target.files?.[0] && void pickRom(e.target.files[0])} />
        {rom && !rom.hashes ? <progress value={rom.progress} max={1} /> : null}
        {rom?.hashes ? (
          <div className="rom-result">
            <code>sha1 {rom.hashes.sha1}</code>
            <code>crc32 {rom.hashes.crc32}</code>
            {rom.known ? (
              <p>
                {t('romKnown', { title: rom.known.title })}{' '}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => update((d) => ({ ...d, game: { existing: rom.known!.id } }))}>
                  {t('romUseGame')}
                </button>
              </p>
            ) : (
              <>
                {rom.dat ? <p>{t('romDat', { name: rom.dat.name })}</p> : <p className="muted">{t('romUnknown')}</p>}
                {isNew ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={addRomIdentifiers}>
                    {t('romAdd')}
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function IdentifierList({ draft, update }: StepProps) {
  const t = useTranslations('form');
  if (!('new' in draft.game)) return null;
  const ids = draft.game.new.identifiers;
  const platform = draft.game.new.platforms[0];
  return (
    <div className="field">
      <span className="field-label">{t('identifiers')}</span>
      <span className="field-hint">{t('identifiersHint')}</span>
      {ids.map((i, n) => (
        <div className="inline-row" key={n}>
          <select value={i.kind} onChange={(e) => update((d) => ('new' in d.game ? ((d.game.new.identifiers[n]!.kind = e.target.value), d) : d))}>
            {ID_KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <input value={i.value} placeholder={t('value')} onChange={(e) => update((d) => ('new' in d.game ? ((d.game.new.identifiers[n]!.value = e.target.value), d) : d))} />
          <input
            value={i.region ?? ''}
            placeholder={t('region')}
            className="short"
            onChange={(e) => update((d) => ('new' in d.game ? ((d.game.new.identifiers[n]!.region = e.target.value), d) : d))}
          />
          <button type="button" className="icon-btn" aria-label={t('remove')} onClick={() => update((d) => ('new' in d.game ? (d.game.new.identifiers.splice(n, 1), d) : d))}>
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => update((d) => ('new' in d.game ? (d.game.new.identifiers.push({ kind: 'sha1', value: '', platform }), d) : d))}
      >
        <Icon name="plus" size={14} />
        {t('addIdentifier')}
      </button>
    </div>
  );
}

/* ---------- 2. Mod ---------- */

function ModStep({ draft, update }: StepProps) {
  const t = useTranslations('form');
  const tt = useTranslations('types');
  const m = draft.mod;
  const set = (k: keyof Draft['mod'], v: unknown) => update((d) => ({ ...d, mod: { ...d.mod, [k]: v } }));
  return (
    <div className="form-grid">
      <h2>{t('step.mod')}</h2>
      <Field label={t('name')}>
        <input value={m.name} maxLength={120} onChange={(e) => set('name', e.target.value)} />
      </Field>
      <Field label={t('type')}>
        <select value={m.type} onChange={(e) => set('type', e.target.value)}>
          {MOD_TYPES.map((x) => (
            <option key={x} value={x}>
              {tt(x)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('summary')} hint={`${m.summary.length}/200`}>
        <input value={m.summary} maxLength={200} onChange={(e) => set('summary', e.target.value)} />
      </Field>
      <Field label={t('description')} hint={t('descriptionHint')}>
        <textarea rows={6} maxLength={5000} value={m.description ?? ''} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <Field label={t('tags')} hint={t('tagsHint')}>
        <input value={m.tags.join(', ')} onChange={(e) => set('tags', e.target.value.split(',').map((x) => x.trim()).slice(0, 8))} />
      </Field>
      <Field label={t('license')}>
        <select value={m.license} onChange={(e) => set('license', e.target.value)}>
          {LICENSES.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
      </Field>
      <div className="field">
        <span className="field-label">{t('authors')}</span>
        {m.authors.map((a, n) => (
          <div className="inline-row" key={n}>
            <input value={a.name} placeholder={t('authorName')} onChange={(e) => update((d) => ((d.mod.authors[n]!.name = e.target.value), d))} />
            <input value={a.github ?? ''} placeholder={t('authorGithub')} onChange={(e) => update((d) => ((d.mod.authors[n]!.github = e.target.value), d))} />
            {m.authors.length > 1 ? (
              <button type="button" className="icon-btn" aria-label={t('remove')} onClick={() => update((d) => (d.mod.authors.splice(n, 1), d))}>
                ×
              </button>
            ) : null}
          </div>
        ))}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => update((d) => (d.mod.authors.push({ name: '' }), d))}>
          <Icon name="plus" size={14} />
          {t('addAuthor')}
        </button>
      </div>
      <Field label={t('homepage')}>
        <input type="url" value={m.homepage ?? ''} placeholder="https://" onChange={(e) => set('homepage', e.target.value)} />
      </Field>
    </div>
  );
}

/* ---------- 3. Compatibility ---------- */

function CompatStep({
  draft,
  update,
  gamePlatforms,
  dumps,
  platforms,
  emulators,
  devices,
}: StepProps & { gamePlatforms: string[]; dumps: Ident[]; platforms: Option[]; emulators: EmulatorOption[]; devices: Option[] }) {
  const t = useTranslations('form');
  const choices = platforms.filter((p) => !gamePlatforms.length || gamePlatforms.includes(p.id));
  return (
    <div className="form-grid">
      <h2>{t('step.compat')}</h2>
      <p className="fineprint">{t('compatHint')}</p>
      {draft.targets.map((tg, n) => (
        <div className="target-card" key={n}>
          <div className="inline-row">
            <select value={tg.platform} onChange={(e) => update((d) => ((d.targets[n]!.platform = e.target.value), (d.targets[n]!.emulator = undefined), d))}>
              <option value="">{t('platform')}</option>
              {choices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select value={tg.emulator ?? ''} onChange={(e) => update((d) => ((d.targets[n]!.emulator = e.target.value || undefined), d))}>
              <option value="">{t('anyEmulator')}</option>
              {emulators
                .filter((e) => e.platforms.includes(tg.platform))
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
            <input className="short" value={tg.min_version ?? ''} placeholder={t('minVersion')} onChange={(e) => update((d) => ((d.targets[n]!.min_version = e.target.value), d))} />
            <input className="short" value={tg.max_version ?? ''} placeholder={t('maxVersion')} onChange={(e) => update((d) => ((d.targets[n]!.max_version = e.target.value), d))} />
            <button type="button" className="icon-btn" aria-label={t('remove')} onClick={() => update((d) => (d.targets.splice(n, 1), d))}>
              ×
            </button>
          </div>
          {dumps.length ? (
            <div className="dump-list">
              <span className="field-hint">{t('dumpsHint')}</span>
              {dumps.map((i) => {
                const on = tg.identifiers.some((x) => x.kind === i.kind && x.value.toLowerCase() === i.value.toLowerCase());
                return (
                  <label className="check" key={`${i.kind}:${i.value}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        update((d) => {
                          const list = d.targets[n]!.identifiers;
                          const at = list.findIndex((x) => x.kind === i.kind && x.value.toLowerCase() === i.value.toLowerCase());
                          if (at >= 0) list.splice(at, 1);
                          else list.push({ kind: i.kind, value: i.value });
                          return d;
                        })
                      }
                    />
                    {i.region ? `${i.region} · ` : ''}
                    {i.kind} <code>{i.value.slice(0, 12)}</code>
                  </label>
                );
              })}
            </div>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => update((d) => (d.targets.push({ platform: gamePlatforms[0] ?? '', identifiers: [] }), d))}
      >
        <Icon name="plus" size={14} />
        {t('addTarget')}
      </button>

      <div className="field">
        <span className="field-label">{t('devices')}</span>
        <span className="field-hint">{t('devicesHint')}</span>
        <div className="chips">
          {devices.map((dv) => (
            <label className="check chip" key={dv.id}>
              <input
                type="checkbox"
                checked={draft.mod.devices.includes(dv.id)}
                onChange={(e) =>
                  update((d) => ((d.mod.devices = e.target.checked ? [...d.mod.devices, dv.id] : d.mod.devices.filter((x) => x !== dv.id)), d))
                }
              />
              {dv.name}
            </label>
          ))}
        </div>
      </div>
      <Field label={t('requires')} hint={t('requiresHint')}>
        <textarea rows={3} value={draft.mod.requires.join('\n')} onChange={(e) => update((d) => ((d.mod.requires = e.target.value.split('\n').slice(0, 10)), d))} />
      </Field>
    </div>
  );
}

/* ---------- 4. Screens ---------- */

function UploadSlot({
  sha,
  label,
  apiUrl,
  onUploaded,
  onClear,
  warn,
}: {
  sha?: string;
  label: string;
  apiUrl: string;
  onUploaded: (r: { sha256: string; width: number; height: number }) => void;
  onClear: () => void;
  warn?: string | null;
}) {
  const t = useTranslations('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(file: File) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set('file', file);
    const r = await bff('uploads', { method: 'POST', body: form });
    setBusy(false);
    if (!r.ok) return setError(r.body?.error ?? t('unknownError'));
    onUploaded(r.body);
  }
  return (
    <div className={`upload-slot${sha ? ' filled' : ''}`}>
      <span className="field-label">{label}</span>
      {sha ? (
        <div className="upload-preview">
          <img src={media(apiUrl, sha, true)} alt="" />
          <button type="button" className="icon-btn" aria-label={t('remove')} onClick={onClear}>
            ×
          </button>
        </div>
      ) : (
        <label
          className="drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) void send(f);
          }}
        >
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && void send(e.target.files[0])} />
          <Icon name="plus" size={22} />
          <span>{busy ? t('uploading') : t('dropImage')}</span>
        </label>
      )}
      {error ? <span className="field-error">{error}</span> : null}
      {warn ? <span className="field-warn">{warn}</span> : null}
    </div>
  );
}

function ScreensStep({
  draft,
  update,
  apiUrl,
  dims,
  setDims,
}: StepProps & { apiUrl: string; dims: Record<string, { w: number; h: number }>; setDims: (fn: (d: Record<string, { w: number; h: number }>) => Record<string, { w: number; h: number }>) => void }) {
  const t = useTranslations('form');
  const remember = (r: { sha256: string; width: number; height: number }) => setDims((d) => ({ ...d, [r.sha256]: { w: r.width, h: r.height } }));
  const previews: Preview[] = useMemo(
    () =>
      draft.screens.pairs
        .filter((p): p is Required<Pick<PairDraft, 'top' | 'bottom'>> & PairDraft => !!p.top && !!p.bottom)
        .map((p) => ({
          top: { url: media(apiUrl, p.top), width: null, height: null, source: 'upload', caption: null },
          bottom: { url: media(apiUrl, p.bottom), width: null, height: null, source: 'upload', caption: null },
          caption: p.caption ?? null,
        })),
    [draft.screens.pairs, apiUrl],
  );
  // A top screen in portrait, or a bottom screen much wider than tall, is probably swapped or cropped wrong
  const warnTop = (sha?: string) => (sha && dims[sha] && dims[sha].h > dims[sha].w ? t('warnTop') : null);
  const warnBottom = (sha?: string) => (sha && dims[sha] && dims[sha].w / dims[sha].h > 2 ? t('warnBottom') : null);

  return (
    <div className="form-grid">
      <h2>{t('step.screens')}</h2>
      <p className="fineprint">{t('screensHint')}</p>
      <div className="screens-layout">
        <div className="pairs">
          {draft.screens.pairs.map((p, n) => (
            <div className="pair-card" key={n}>
              <div className="pair-head">
                <strong>{t('pair', { n: n + 1 })}</strong>
                {draft.screens.pairs.length > 1 ? (
                  <button type="button" className="icon-btn" aria-label={t('remove')} onClick={() => update((d) => (d.screens.pairs.splice(n, 1), d))}>
                    ×
                  </button>
                ) : null}
              </div>
              <UploadSlot
                sha={p.top}
                label={t('topScreen')}
                apiUrl={apiUrl}
                warn={warnTop(p.top)}
                onUploaded={(r) => (remember(r), update((d) => ((d.screens.pairs[n]!.top = r.sha256), d)))}
                onClear={() => update((d) => ((d.screens.pairs[n]!.top = undefined), d))}
              />
              <UploadSlot
                sha={p.bottom}
                label={t('bottomScreen')}
                apiUrl={apiUrl}
                warn={warnBottom(p.bottom)}
                onUploaded={(r) => (remember(r), update((d) => ((d.screens.pairs[n]!.bottom = r.sha256), d)))}
                onClear={() => update((d) => ((d.screens.pairs[n]!.bottom = undefined), d))}
              />
              <input value={p.caption ?? ''} maxLength={140} placeholder={t('caption')} onChange={(e) => update((d) => ((d.screens.pairs[n]!.caption = e.target.value), d))} />
              {p.top ? (
                <label className="check">
                  <input type="radio" name="cover" checked={draft.screens.cover === p.top || (!draft.screens.cover && n === 0)} onChange={() => update((d) => ((d.screens.cover = p.top), d))} />
                  {t('useAsCover')}
                </label>
              ) : null}
            </div>
          ))}
          {draft.screens.pairs.length < 6 ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => update((d) => (d.screens.pairs.push({}), d))}>
              <Icon name="plus" size={14} />
              {t('addPair')}
            </button>
          ) : null}
        </div>
        <div className="live-preview">
          <span className="field-label">{t('livePreview')}</span>
          {previews.length ? <DualScreenPreview previews={previews} /> : <p className="empty">{t('previewEmpty')}</p>}
        </div>
      </div>

      <div className="field">
        <span className="field-label">{t('gallery')}</span>
        <span className="field-hint">{t('galleryHint')}</span>
        <div className="gallery-edit">
          {draft.screens.gallery.map((g, n) => (
            <div key={g} className="gallery-edit-item">
              <UploadSlot sha={g} label="" apiUrl={apiUrl} onUploaded={() => {}} onClear={() => update((d) => (d.screens.gallery.splice(n, 1), d))} />
              <label className="check">
                <input type="radio" name="cover" checked={draft.screens.cover === g} onChange={() => update((d) => ((d.screens.cover = g), d))} />
                {t('useAsCover')}
              </label>
            </div>
          ))}
          {draft.screens.gallery.length < 8 ? (
            <UploadSlot label="" apiUrl={apiUrl} onUploaded={(r) => (remember(r), update((d) => (d.screens.gallery.push(r.sha256), d)))} onClear={() => {}} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ---------- 5. Download ---------- */

function DownloadStep({ draft, update }: StepProps) {
  const t = useTranslations('form');
  const d0 = draft.download;
  return (
    <div className="form-grid">
      <h2>{t('step.download')}</h2>
      <div className="segmented-tabs">
        <button type="button" className={d0.kind === 'manual' ? 'on' : ''} onClick={() => update((d) => ({ ...d, download: { kind: 'manual', version: '1.0', files: [{ label: '', role: 'main', url: '' }] } }))}>
          {t('downloadManual')}
        </button>
        <button type="button" className={d0.kind === 'github' ? 'on' : ''} onClick={() => update((d) => ({ ...d, download: { kind: 'github', github: '', assets: [{ role: 'main', pattern: '*.zip' }], prereleases: false } }))}>
          {t('downloadGithub')}
        </button>
      </div>
      {d0.kind === 'github' ? (
        <>
          <p className="fineprint">{t('githubHint')}</p>
          <Field label={t('githubRepo')}>
            <input value={d0.github} placeholder="owner/repo" onChange={(e) => update((d) => (d.download.kind === 'github' ? ((d.download.github = e.target.value.replace(/^https:\/\/github\.com\//, '')), d) : d))} />
          </Field>
          <div className="field">
            <span className="field-label">{t('assetPatterns')}</span>
            {d0.assets.map((a, n) => (
              <div className="inline-row" key={n}>
                <select value={a.role} onChange={(e) => update((d) => (d.download.kind === 'github' ? ((d.download.assets[n]!.role = e.target.value), d) : d))}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`role.${r}`)}
                    </option>
                  ))}
                </select>
                <input value={a.pattern} placeholder="*.zip" onChange={(e) => update((d) => (d.download.kind === 'github' ? ((d.download.assets[n]!.pattern = e.target.value), d) : d))} />
                <button type="button" className="icon-btn" aria-label={t('remove')} onClick={() => update((d) => (d.download.kind === 'github' ? (d.download.assets.splice(n, 1), d) : d))}>
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => update((d) => (d.download.kind === 'github' ? (d.download.assets.push({ role: 'companion_apk', pattern: '*.apk' }), d) : d))}>
              <Icon name="plus" size={14} />
              {t('addPattern')}
            </button>
          </div>
          <label className="check">
            <input type="checkbox" checked={d0.prereleases} onChange={(e) => update((d) => (d.download.kind === 'github' ? ((d.download.prereleases = e.target.checked), d) : d))} />
            {t('prereleases')}
          </label>
        </>
      ) : (
        <>
          <div className="inline-row">
            <Field label={t('version')}>
              <input value={d0.version} onChange={(e) => update((d) => (d.download.kind === 'manual' ? ((d.download.version = e.target.value), d) : d))} />
            </Field>
            <Field label={t('releasedAt')}>
              <input type="date" value={d0.released_at ?? ''} onChange={(e) => update((d) => (d.download.kind === 'manual' ? ((d.download.released_at = e.target.value), d) : d))} />
            </Field>
          </div>
          <div className="field">
            <span className="field-label">{t('files')}</span>
            <span className="field-hint">{t('filesHint')}</span>
            {d0.files.map((f, n) => (
              <div className="inline-row" key={n}>
                <input value={f.label} placeholder={t('fileLabel')} onChange={(e) => update((d) => (d.download.kind === 'manual' ? ((d.download.files[n]!.label = e.target.value), d) : d))} />
                <select value={f.role} onChange={(e) => update((d) => (d.download.kind === 'manual' ? ((d.download.files[n]!.role = e.target.value), d) : d))}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`role.${r}`)}
                    </option>
                  ))}
                </select>
                <input type="url" value={f.url} placeholder="https://" onChange={(e) => update((d) => (d.download.kind === 'manual' ? ((d.download.files[n]!.url = e.target.value), d) : d))} />
                <button type="button" className="icon-btn" aria-label={t('remove')} onClick={() => update((d) => (d.download.kind === 'manual' ? (d.download.files.splice(n, 1), d) : d))}>
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => update((d) => (d.download.kind === 'manual' ? (d.download.files.push({ label: '', role: 'optional', url: '' }), d) : d))}>
              <Icon name="plus" size={14} />
              {t('addFile')}
            </button>
          </div>
          <Field label={t('pageUrl')} hint={t('pageUrlHint')}>
            <input type="url" value={d0.page_url ?? ''} placeholder="https://" onChange={(e) => update((d) => (d.download.kind === 'manual' ? ((d.download.page_url = e.target.value), d) : d))} />
          </Field>
          <Field label={t('changelog')}>
            <textarea rows={4} value={d0.changelog ?? ''} onChange={(e) => update((d) => (d.download.kind === 'manual' ? ((d.download.changelog = e.target.value), d) : d))} />
          </Field>
        </>
      )}
    </div>
  );
}

/* ---------- 6. Install ---------- */

function InstallStep({ draft, update, roles }: StepProps & { roles: string[] }) {
  const t = useTranslations('form');
  const setStep = (n: number, patch: Partial<StepDraft>) => update((d) => ((d.install[n] = { ...d.install[n]!, ...patch }), d));
  return (
    <div className="form-grid">
      <h2>{t('step.install')}</h2>
      <p className="fineprint">{t('installHint')}</p>
      {draft.install.map((s, n) => (
        <div className="target-card" key={n}>
          <div className="inline-row">
            <select value={s.action} onChange={(e) => setStep(n, { action: e.target.value as StepDraft['action'] })}>
              {(['extract', 'copy', 'install_apk', 'note'] as const).map((a) => (
                <option key={a} value={a}>
                  {t(`action.${a}`)}
                </option>
              ))}
            </select>
            {s.action !== 'note' ? (
              <select value={s.asset ?? ''} onChange={(e) => setStep(n, { asset: e.target.value })}>
                <option value="">{t('whichFile')}</option>
                {[...new Set(roles)].map((r) => (
                  <option key={r} value={r}>
                    {t(`role.${r}`)}
                  </option>
                ))}
              </select>
            ) : null}
            <button type="button" className="icon-btn" aria-label={t('remove')} onClick={() => update((d) => (d.install.splice(n, 1), d))}>
              ×
            </button>
          </div>
          {s.action === 'extract' || s.action === 'copy' ? (
            <>
              <input value={s.to ?? ''} placeholder="{emulator.textures_dir}/{game.title_id}" onChange={(e) => setStep(n, { to: e.target.value })} />
              <div className="chips">
                {PATH_VARS.map((v) => (
                  <button type="button" key={v} className="chip chip-btn" onClick={() => setStep(n, { to: `${s.to ?? ''}${v}` })}>
                    {v}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {s.action === 'note' ? <textarea rows={2} value={s.text ?? ''} onChange={(e) => setStep(n, { text: e.target.value })} /> : null}
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => update((d) => (d.install.push({ action: 'extract', asset: roles[0], to: '' }), d))}>
        <Icon name="plus" size={14} />
        {t('addStep')}
      </button>
    </div>
  );
}
