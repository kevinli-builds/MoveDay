'use client'

// MoveDay root — the comparison board (FABLE_BRIEF.md §2, M1).
// State lives in one Hunt object; every change persists to localStorage.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FurnTemplate, Hunt, Listing, ListingStatus } from './lib/types'
import { LISTING_STATUSES, dollarsPerSqft } from './lib/types'
import { defaultHunt, loadHunt, normalizeHunt, saveHunt } from './lib/storage'
import { composeFitCheckPlan, furnisherImportUrl } from './lib/handoff'
import { FURN_COLORS, FURN_TYPES } from './lib/furnitureTypes'
import { safeUrl } from './lib/sanitize'

type SortKey = 'name' | 'status' | 'rentMonthly' | 'sqft' | 'psf' | 'rating' | 'createdAt'

const STATUS_ORDER: Record<ListingStatus, number> = {
  signed: 0, applied: 1, toured: 2, touring: 3, saved: 4, rejected: 5,
}

function sortValue(l: Listing, key: SortKey): number | string {
  switch (key) {
    case 'name': return l.name.toLowerCase()
    case 'status': return STATUS_ORDER[l.status]
    case 'rentMonthly': return l.rentMonthly ?? Infinity
    case 'sqft': return l.sqft ?? -1
    case 'psf': return dollarsPerSqft(l) ?? Infinity
    case 'rating': return l.tour?.rating ?? -1
    case 'createdAt': return l.createdAt
  }
}

export default function Home() {
  const [hunt, setHunt] = useState<Hunt>(defaultHunt)
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<Listing | 'new' | null>(null)
  const [furnOpen, setFurnOpen] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortAsc, setSortAsc] = useState(true)
  const importRef = useRef<HTMLInputElement>(null)

  // Load after mount (avoids SSR/hydration mismatch — Furnisher pattern).
  useEffect(() => {
    setHunt(loadHunt())
    setLoaded(true)
  }, [])
  useEffect(() => {
    if (loaded) saveHunt(hunt)
  }, [hunt, loaded])

  const update = (fn: (h: Hunt) => Hunt) => setHunt((h) => normalizeHunt(fn(h)))

  const upsertListing = (l: Listing) =>
    update((h) => ({
      ...h,
      listings: h.listings.some((x) => x.id === l.id)
        ? h.listings.map((x) => (x.id === l.id ? l : x))
        : [...h.listings, l],
    }))

  const removeListing = (id: string) =>
    update((h) => ({ ...h, listings: h.listings.filter((x) => x.id !== id) }))

  const sorted = useMemo(() => {
    const rows = [...hunt.listings].sort((a, b) => {
      const av = sortValue(a, sortKey)
      const bv = sortValue(b, sortKey)
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortAsc ? cmp : -cmp
    })
    // Pinned floats to the top regardless of sort.
    return rows.sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false))
  }, [hunt.listings, sortKey, sortAsc])

  const clickSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(true) }
  }

  // ── Export / import: the hunt is localStorage-only, so a JSON bundle is the
  // backup story. Photos (IndexedDB, M1 remaining) are not in the bundle.
  const exportHunt = () => {
    const blob = new Blob([JSON.stringify(hunt, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const slug = hunt.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'hunt'
    a.download = `moveday-${slug}-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    let next: Hunt
    try {
      next = normalizeHunt(JSON.parse(await file.text()))
    } catch {
      alert("That file doesn't look like a MoveDay export.")
      return
    }
    const ok = confirm(
      `Replace "${hunt.name}" (${hunt.listings.length} listing${hunt.listings.length === 1 ? '' : 's'}) ` +
      `with "${next.name}" (${next.listings.length} listing${next.listings.length === 1 ? '' : 's'})? ` +
      'Your current hunt will be overwritten — Export it first if unsure.',
    )
    if (ok) update(() => next)
  }

  const openInFurnisher = (l: Listing) => {
    if (!l.planJson || typeof l.planJson !== 'object') return
    const plan = composeFitCheckPlan(l.planJson as Record<string, unknown>, hunt.myFurniture, l.name)
    const url = furnisherImportUrl({ v: 1, source: 'moveday', name: l.name, listingId: l.id, plan })
    if (url) window.open(url, '_blank', 'noopener')
    else alert('This plan is too large for a link — use Copy plan JSON instead (coming in M2).')
  }

  const th = (label: string, key: SortKey, num = false) => (
    <th className={(key === sortKey ? 'active ' : '') + (num ? 'num' : '')} onClick={() => clickSort(key)}>
      {label} {key === sortKey ? (sortAsc ? '▲' : '▼') : ''}
    </th>
  )

  return (
    <main className="shell">
      <div className="masthead">
        <h1><span className="box">📦</span> MoveDay</h1>
        <span className="hunt-name">{hunt.name}</span>
      </div>
      <p className="tagline">Compare listings, remember your tours — and check your furniture actually fits.</p>

      <div className="toolbar">
        <button className="primary" onClick={() => setEditing('new')}>+ Add listing</button>
        <button onClick={() => setFurnOpen(true)}>
          🛋️ My furniture{hunt.myFurniture.length > 0 ? ` (${hunt.myFurniture.length})` : ''}
        </button>
        <div className="spacer" />
        <button className="subtle" onClick={exportHunt} title="Download this hunt as a JSON backup">Export</button>
        <button className="subtle" onClick={() => importRef.current?.click()} title="Restore a hunt from a JSON backup">Import</button>
        <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={onImportFile} />
      </div>

      {sorted.length === 0 ? (
        <div className="empty">
          <span className="big">🏷️</span>
          No listings yet. Add the first one as you browse — 30 seconds per listing,
          your future post-tour self will thank you.
        </div>
      ) : (
        <div className="board-wrap">
          <table className="board">
            <thead>
              <tr>
                <th></th>
                {th('Listing', 'name')}
                {th('Status', 'status')}
                {th('Rent', 'rentMonthly', true)}
                {th('Sqft', 'sqft', true)}
                {th('$/sqft', 'psf', true)}
                {th('Gut', 'rating')}
                <th>Three words</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {/* The whole row opens Edit — on phones the action column sits
                  past the horizontal scroll, so it can't be the only way in. */}
              {sorted.map((l) => (
                <tr key={l.id} className={l.pinned ? 'pinned' : ''} onClick={() => setEditing(l)}>
                  <td>
                    <button
                      className={'subtle pin-btn' + (l.pinned ? ' on' : '')}
                      title={l.pinned ? 'Unpin' : 'Pin as favorite'}
                      onClick={(e) => { e.stopPropagation(); upsertListing({ ...l, pinned: !l.pinned }) }}
                    >📌</button>
                  </td>
                  <td className="name-cell">
                    {l.url && safeUrl(l.url) ? (
                      <a href={safeUrl(l.url)!} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{l.name}</a>
                    ) : l.name}
                  </td>
                  <td><span className={'pill ' + l.status}>{l.status}</span></td>
                  <td className="num">{l.rentMonthly != null ? `$${l.rentMonthly.toLocaleString()}` : '—'}</td>
                  <td className="num">{l.sqft ?? '—'}</td>
                  <td className="num">{dollarsPerSqft(l) != null ? `$${dollarsPerSqft(l)!.toFixed(2)}` : '—'}</td>
                  <td><span className="stars">{l.tour?.rating ? '★'.repeat(l.tour.rating) : '—'}</span></td>
                  <td className="words">{l.tour?.threeWords ?? ''}</td>
                  <td>
                    {l.planJson ? (
                      <button className="subtle" title="Open in Furnisher with your furniture staged" onClick={(e) => { e.stopPropagation(); openInFurnisher(l) }}>🛋️ Fit</button>
                    ) : null}
                    <button className="subtle" onClick={(e) => { e.stopPropagation(); setEditing(l) }}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="footnote">
        Everything stays on this device (localStorage). Export/backup, photos, commutes and the
        Furnisher bridge land next — see FABLE_BRIEF.md.
      </p>

      {editing && (
        <ListingDialog
          listing={editing === 'new' ? null : editing}
          onSave={(l) => { upsertListing(l); setEditing(null) }}
          onDelete={editing !== 'new' ? () => { removeListing((editing as Listing).id); setEditing(null) } : undefined}
          onClose={() => setEditing(null)}
        />
      )}

      {furnOpen && (
        <FurnitureDialog
          furniture={hunt.myFurniture}
          onChange={(myFurniture) => update((h) => ({ ...h, myFurniture }))}
          onClose={() => setFurnOpen(false)}
        />
      )}
    </main>
  )
}

// ── Add / edit dialog (includes post-tour capture) ─────────────────

function ListingDialog({
  listing, onSave, onDelete, onClose,
}: {
  listing: Listing | null
  onSave: (l: Listing) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Listing>(
    listing ?? {
      id: `l-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      status: 'saved',
      name: '',
      photoIds: [],
      commutes: [],
    },
  )
  const set = <K extends keyof Listing>(k: K, v: Listing[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const numField = (v: string) => (v.trim() === '' ? undefined : Number(v))

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{listing ? 'Edit listing' : 'Add listing'}</h2>
        <div className="grid2">
          <div className="field full">
            <label>Name</label>
            <input autoFocus value={draft.name} placeholder="Maple St 2BR" onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="field full">
            <label>Address</label>
            <input value={draft.address ?? ''} placeholder="123 Maple St, Apt 4" onChange={(e) => set('address', e.target.value || undefined)} />
          </div>
          <div className="field full">
            <label>Listing URL</label>
            <input value={draft.url ?? ''} placeholder="https://…" onChange={(e) => set('url', e.target.value || undefined)} />
          </div>
          <div className="field">
            <label>Rent / month ($)</label>
            <input type="number" min="0" value={draft.rentMonthly ?? ''} onChange={(e) => set('rentMonthly', numField(e.target.value))} />
          </div>
          <div className="field">
            <label>Sqft</label>
            <input type="number" min="0" value={draft.sqft ?? ''} onChange={(e) => set('sqft', numField(e.target.value))} />
          </div>
          <div className="field">
            <label>Beds</label>
            <input type="number" min="0" step="1" value={draft.beds ?? ''} onChange={(e) => set('beds', numField(e.target.value))} />
          </div>
          <div className="field">
            <label>Baths</label>
            <input type="number" min="0" step="0.5" value={draft.baths ?? ''} onChange={(e) => set('baths', numField(e.target.value))} />
          </div>
          <div className="field">
            <label>Status</label>
            <select value={draft.status} onChange={(e) => set('status', e.target.value as ListingStatus)}>
              {LISTING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Available from</label>
            <input type="date" value={draft.availableFrom ?? ''} onChange={(e) => set('availableFrom', e.target.value || undefined)} />
          </div>
          <div className="field full">
            <label>Gut rating (after the tour)</label>
            <div className="rate-row">
              {([1, 2, 3, 4, 5] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  className={draft.tour?.rating === r ? 'on' : ''}
                  onClick={() =>
                    set('tour', {
                      ...draft.tour,
                      rating: draft.tour?.rating === r ? undefined : r,
                      touredAt: draft.tour?.touredAt ?? new Date().toISOString().slice(0, 10),
                    })
                  }
                >{draft.tour?.rating && draft.tour.rating >= r ? '★' : '☆'}</button>
              ))}
            </div>
          </div>
          <div className="field full">
            <label>Three words (what you&apos;ll forget by tour #5)</label>
            <input
              value={draft.tour?.threeWords ?? ''}
              placeholder="bright, tiny kitchen, street noise"
              onChange={(e) => set('tour', { ...draft.tour, threeWords: e.target.value || undefined })}
            />
          </div>
          <div className="field full">
            <label>Notes</label>
            <textarea rows={3} value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value || undefined)} />
          </div>
          <div className="field full">
            <label>Floor plan (from Furnisher)</label>
            {draft.planJson ? (
              <div className="plan-attached">
                ✓ Plan attached — the 🛋️ Fit button opens it in Furnisher with your furniture staged.
                <button type="button" className="subtle danger" onClick={() => set('planJson', undefined)}>Remove</button>
              </div>
            ) : (
              <PlanPaste onAttach={(plan) => set('planJson', plan)} />
            )}
          </div>
        </div>
        <div className="dialog-actions">
          {onDelete && <button className="danger" onClick={() => { if (confirm('Delete this listing?')) onDelete() }}>Delete</button>}
          <div className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!draft.name.trim()} onClick={() => onSave(draft)}>Save</button>
        </div>
      </div>
    </div>
  )
}

// Paste-import of a Furnisher plan (FABLE_BRIEF §4): draw/AI-import the listing's
// floor plan in Furnisher, copy its share link or plan JSON, paste either here.
// Share links carry the plan in their #import= fragment; raw JSON is parsed
// directly. Stored opaque — sanitized again wherever it renders.
function PlanPaste({ onAttach }: { onAttach: (plan: Record<string, unknown>) => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  const attach = async () => {
    setError('')
    const raw = text.trim()
    if (!raw) return
    try {
      let plan: unknown
      const frag = /#import=(.+)$/.exec(raw)
      if (frag) {
        const { decompressFromEncodedURIComponent } = await import('lz-string')
        const json = decompressFromEncodedURIComponent(frag[1])
        const payload = json ? (JSON.parse(json) as { plan?: unknown }) : null
        plan = payload?.plan
      } else {
        plan = JSON.parse(raw)
      }
      if (!plan || typeof plan !== 'object' || Array.isArray(plan) || !Array.isArray((plan as { rooms?: unknown }).rooms)) {
        setError('That doesn’t look like a Furnisher plan — paste a share link or the plan JSON (it should contain "rooms").')
        return
      }
      onAttach(plan as Record<string, unknown>)
      setText('')
    } catch {
      setError('Couldn’t read that — paste a Furnisher share link or valid plan JSON.')
    }
  }

  return (
    <div>
      <textarea
        rows={2}
        placeholder="Paste a Furnisher share link (…#import=…) or plan JSON"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="plan-paste-row">
        <button type="button" disabled={!text.trim()} onClick={attach}>Attach plan</button>
        {error && <span className="plan-paste-error">{error}</span>}
      </div>
    </div>
  )
}

// ── My-furniture manager (FABLE_BRIEF §7 M4, pulled early) ─────────
// The pieces the 🛋️ Fit button stages into every fit-check. Type values and
// default footprints mirror Furnisher's catalog so glyphs render properly.

function FurnitureDialog({
  furniture, onChange, onClose,
}: {
  furniture: FurnTemplate[]
  onChange: (list: FurnTemplate[]) => void
  onClose: () => void
}) {
  const blank = () => {
    const t = FURN_TYPES[0]
    return {
      id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: '',
      type: t.value,
      w: t.w,
      h: t.h,
      color: FURN_COLORS[furniture.length % FURN_COLORS.length],
    } as FurnTemplate
  }
  const [draft, setDraft] = useState<FurnTemplate>(blank)
  const [editingId, setEditingId] = useState<string | null>(null) // null = adding

  const set = <K extends keyof FurnTemplate>(k: K, v: FurnTemplate[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const numField = (v: string) => (v.trim() === '' ? 0 : Number(v))

  // Picking a type prefills its default footprint (still editable after).
  const pickType = (value: string) => {
    const t = FURN_TYPES.find((x) => x.value === value) ?? FURN_TYPES[FURN_TYPES.length - 1]
    setDraft((d) => ({ ...d, type: t.value, w: t.w, h: t.h }))
  }

  const valid = draft.name.trim() && draft.w > 0 && draft.h > 0
  const save = () => {
    if (!valid) return
    const piece = { ...draft, name: draft.name.trim().slice(0, 80) }
    onChange(
      editingId
        ? furniture.map((f) => (f.id === editingId ? piece : f))
        : [...furniture, piece],
    )
    setEditingId(null)
    setDraft(blank())
  }
  const startEdit = (f: FurnTemplate) => { setEditingId(f.id); setDraft(f) }
  const remove = (f: FurnTemplate) => {
    if (!confirm(`Remove "${f.name}"?`)) return
    if (editingId === f.id) { setEditingId(null); setDraft(blank()) }
    onChange(furniture.filter((x) => x.id !== f.id))
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>My furniture</h2>
        <p className="furn-hint">
          The pieces you own (or plan to buy). The 🛋️ Fit button stages them next to a
          listing&apos;s floor plan in Furnisher so you can check they actually fit.
        </p>

        {furniture.length > 0 && (
          <div className="furn-list">
            {furniture.map((f) => (
              <div className="furn-row" key={f.id}>
                <span className="furn-dot" style={{ background: f.color }} />
                <span className="furn-name">{f.name}</span>
                <span className="furn-dims">
                  {FURN_TYPES.find((t) => t.value === f.type)?.label ?? 'Other'} · {f.w}×{f.h} cm
                </span>
                <button className="subtle" onClick={() => startEdit(f)}>Edit</button>
                <button className="subtle danger" onClick={() => remove(f)}>Remove</button>
              </div>
            ))}
          </div>
        )}
        {furniture.length === 0 && (
          <p className="furn-empty">Nothing yet — add your sofa, bed, desk…</p>
        )}

        <div className="furn-form">
          <div className="grid2">
            <div className="field full">
              <label>{editingId ? 'Editing piece' : 'Add a piece'}</label>
              <input
                value={draft.name}
                placeholder="Grey sofa"
                onChange={(e) => set('name', e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
              />
            </div>
            <div className="field">
              <label>Type</label>
              <select value={draft.type} onChange={(e) => pickType(e.target.value)}>
                {FURN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Width × depth (cm)</label>
              <div className="furn-dims-inputs">
                <input type="number" min="1" value={draft.w || ''} onChange={(e) => set('w', numField(e.target.value))} />
                <span>×</span>
                <input type="number" min="1" value={draft.h || ''} onChange={(e) => set('h', numField(e.target.value))} />
              </div>
            </div>
            <div className="field full">
              <label>Color</label>
              <div className="furn-colors">
                {FURN_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={'furn-swatch' + (draft.color === c ? ' on' : '')}
                    style={{ background: c }}
                    onClick={() => set('color', c)}
                    aria-label={`Color ${c}`}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="dialog-actions">
            {editingId && (
              <button onClick={() => { setEditingId(null); setDraft(blank()) }}>Cancel edit</button>
            )}
            <div className="spacer" />
            <button onClick={onClose}>Done</button>
            <button className="primary" disabled={!valid} onClick={save}>
              {editingId ? 'Save piece' : '+ Add piece'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
