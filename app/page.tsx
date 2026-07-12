'use client'

// MoveDay root — the comparison board (FABLE_BRIEF.md §2, M1).
// State lives in one Hunt object; every change persists to localStorage.

import { useEffect, useMemo, useState } from 'react'
import type { Hunt, Listing, ListingStatus } from './lib/types'
import { LISTING_STATUSES, dollarsPerSqft } from './lib/types'
import { defaultHunt, loadHunt, normalizeHunt, saveHunt } from './lib/storage'
import { composeFitCheckPlan, furnisherImportUrl } from './lib/handoff'
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
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortAsc, setSortAsc] = useState(true)

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
        <div className="spacer" />
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
              {sorted.map((l) => (
                <tr key={l.id} className={l.pinned ? 'pinned' : ''}>
                  <td>
                    <button
                      className={'subtle pin-btn' + (l.pinned ? ' on' : '')}
                      title={l.pinned ? 'Unpin' : 'Pin as favorite'}
                      onClick={() => upsertListing({ ...l, pinned: !l.pinned })}
                    >📌</button>
                  </td>
                  <td className="name-cell">
                    {l.url && safeUrl(l.url) ? (
                      <a href={safeUrl(l.url)!} target="_blank" rel="noopener noreferrer">{l.name}</a>
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
                      <button className="subtle" title="Open in Furnisher with your furniture staged" onClick={() => openInFurnisher(l)}>🛋️ Fit</button>
                    ) : null}
                    <button className="subtle" onClick={() => setEditing(l)}>Edit</button>
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
