'use client'

// MoveDay root — the comparison board (FABLE_BRIEF.md §2, M1).
// State lives in one Hunt object; every change persists to localStorage.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Anchor, CommuteEntry, FurnTemplate, Hunt, Listing, ListingStatus } from './lib/types'
import { LISTING_STATUSES, dollarsPerSqft } from './lib/types'
import { defaultHunt, huntIsEmpty, loadHunt, normalizeHunt, saveHunt } from './lib/storage'
import { supabaseEnabled } from './lib/supabase'
import { signInWithGoogle, signOut, useAuth } from './lib/auth'
import { pullHunt, pushHunt } from './lib/cloud'
import { hasApiKey, parseListingText, setApiKey, type ParsedListing } from './lib/anthropic'
import { computeRecap } from './lib/recap'
import { composeFitCheckPlan, furnisherImportUrl, unpackHandoff } from './lib/handoff'
import { FURN_COLORS, FURN_TYPES } from './lib/furnitureTypes'
import { safeUrl } from './lib/sanitize'
import { PlanMiniMap } from './components/PlanMiniMap'
import {
  addPhotoFromDataUri,
  addPhotoFromFile,
  blobToDataUri,
  deletePhotos,
  getPhotoBlob,
  MAX_PHOTOS_PER_LISTING,
  sweepOrphanPhotos,
  validateBundlePhotos,
} from './lib/photos'
import { driveMinutes, geocode, sleep, transitDeepLink, walkFallbackMinutes } from './lib/commute'

type SortKey = 'name' | 'status' | 'rentMonthly' | 'sqft' | 'psf' | 'rating' | 'commute' | 'createdAt'

const STATUS_ORDER: Record<ListingStatus, number> = {
  signed: 0, applied: 1, toured: 2, touring: 3, saved: 4, rejected: 5,
}

function sortValue(l: Listing, key: SortKey, anchor0Id?: string): number | string {
  switch (key) {
    case 'name': return l.name.toLowerCase()
    case 'status': return STATUS_ORDER[l.status]
    case 'rentMonthly': return l.rentMonthly ?? Infinity
    case 'sqft': return l.sqft ?? -1
    case 'psf': return dollarsPerSqft(l) ?? Infinity
    case 'rating': return l.tour?.rating ?? -1
    case 'commute': return l.commutes.find((c) => c.anchorId === anchor0Id)?.driveMin ?? Infinity
    case 'createdAt': return l.createdAt
  }
}

export default function Home() {
  const [hunt, setHunt] = useState<Hunt>(defaultHunt)
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<Listing | 'new' | null>(null)
  const [furnOpen, setFurnOpen] = useState(false)
  const [anchorsOpen, setAnchorsOpen] = useState(false)
  const [recapOpen, setRecapOpen] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortAsc, setSortAsc] = useState(true)
  const importRef = useRef<HTMLInputElement>(null)
  // A plan arriving back from Furnisher via #plan= (M4 return trip).
  const [incomingPlan, setIncomingPlan] = useState<{ name: string; plan: Record<string, unknown>; listingId?: string } | null>(null)

  // Optional cloud sync (only when Supabase env is configured — local-first stays
  // the default). One hunt document per user; last-write-wins; photos stay local.
  const { user, ready: authReady } = useAuth()
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'saved' | 'error'>('idle')
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Set right after we adopt a pulled hunt, so the save effect doesn't immediately
  // echo it back up as a redundant push.
  const skipNextPush = useRef(false)

  // Load after mount (avoids SSR/hydration mismatch — Furnisher pattern).
  useEffect(() => {
    const h = loadHunt()
    setHunt(h)
    setLoaded(true)
    // Tidy photo blobs no listing references (canceled edits, old imports).
    void sweepOrphanPhotos(h.listings.flatMap((l) => l.photoIds))
    // A Furnisher "Send to MoveDay" link lands as #plan=<packed>. Clear the hash
    // first (so refresh doesn't re-prompt), then stage the plan for attach —
    // untrusted, kept opaque and only ever rendered through the sanitizing
    // mini-map / re-sent to Furnisher (which re-normalizes on its side).
    const m = /^#plan=(.+)$/.exec(window.location.hash)
    if (m) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      const payload = unpackHandoff(m[1])
      if (payload) setIncomingPlan({ name: payload.name, plan: payload.plan, listingId: payload.listingId })
    }
  }, [])

  const attachPlan = (listingId: string, plan: Record<string, unknown>) => {
    const target = hunt.listings.find((x) => x.id === listingId)
    if (target) upsertListing({ ...target, planJson: plan })
    setIncomingPlan(null)
  }
  // Persist every change to localStorage (always) and, when signed in, debounce
  // a push to the cloud. localStorage remains the source of truth on-device.
  useEffect(() => {
    if (!loaded) return
    saveHunt(hunt)
    if (!supabaseEnabled || !user) return
    if (skipNextPush.current) {
      skipNextPush.current = false
      return
    }
    setSyncStatus('syncing')
    if (pushTimer.current) clearTimeout(pushTimer.current)
    pushTimer.current = setTimeout(() => {
      pushHunt(hunt)
        .then(() => setSyncStatus('saved'))
        .catch((e) => { console.error('[moveday] cloud push failed', e); setSyncStatus('error') })
    }, 800)
  }, [hunt, loaded, user])

  // On sign-in, reconcile this device's hunt with the account's. Auto-resolves
  // when only one side has content; prompts only when both do (never silently
  // discards data). Runs once per sign-in.
  useEffect(() => {
    if (!supabaseEnabled || !user || !loaded) return
    let cancelled = false
    ;(async () => {
      try {
        const cloud = await pullHunt()
        if (cancelled) return
        if (!cloud) {
          await pushHunt(hunt) // first sync from this account → adopt local
          setSyncStatus('saved')
          return
        }
        const localEmpty = huntIsEmpty(hunt)
        const cloudEmpty = huntIsEmpty(cloud.data)
        if (!localEmpty && !cloudEmpty) {
          const useCloud = window.confirm(
            `This device has ${hunt.listings.length} listing(s); your account has ${cloud.data.listings.length}. ` +
            `\n\nOK = load your account's hunt (replaces what's on this device).` +
            `\nCancel = keep this device and overwrite your account.`,
          )
          if (useCloud) { skipNextPush.current = true; update(() => cloud.data) }
          else { await pushHunt(hunt); setSyncStatus('saved') }
        } else if (!cloudEmpty) {
          skipNextPush.current = true
          update(() => cloud.data) // only the cloud has content → adopt it
        } else if (!localEmpty) {
          await pushHunt(hunt) // only this device has content → save it up
          setSyncStatus('saved')
        }
      } catch (e) {
        console.error('[moveday] cloud pull failed', e)
        setSyncStatus('error')
      }
    })()
    return () => { cancelled = true }
    // Intentionally only re-run when the signed-in user changes (merge is a
    // sign-in-moment action) — hunt is read at call time, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loaded])

  const update = (fn: (h: Hunt) => Hunt) => setHunt((h) => normalizeHunt(fn(h)))

  const upsertListing = (l: Listing) =>
    update((h) => ({
      ...h,
      listings: h.listings.some((x) => x.id === l.id)
        ? h.listings.map((x) => (x.id === l.id ? l : x))
        : [...h.listings, l],
    }))

  const removeListing = (id: string) => {
    const gone = hunt.listings.find((x) => x.id === id)
    if (gone && gone.photoIds.length > 0) void deletePhotos(gone.photoIds)
    update((h) => ({ ...h, listings: h.listings.filter((x) => x.id !== id) }))
  }

  const anchor0 = hunt.anchors[0]
  const sorted = useMemo(() => {
    const rows = [...hunt.listings].sort((a, b) => {
      const av = sortValue(a, sortKey, anchor0?.id)
      const bv = sortValue(b, sortKey, anchor0?.id)
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortAsc ? cmp : -cmp
    })
    // Pinned floats to the top regardless of sort.
    return rows.sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false))
  }, [hunt.listings, sortKey, sortAsc, anchor0?.id])

  const clickSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(true) }
  }

  // ── Export / import: the hunt is localStorage-only, so a JSON bundle is the
  // backup story. Photos ride along inlined as data URIs (re-encoded on upload,
  // so a full hunt stays a sane file size).
  const exportHunt = async () => {
    const photos: Record<string, string> = {}
    for (const id of hunt.listings.flatMap((l) => l.photoIds)) {
      const blob = await getPhotoBlob(id)
      if (blob) photos[id] = await blobToDataUri(blob)
    }
    const blob = new Blob([JSON.stringify({ ...hunt, photos }, null, 2)], { type: 'application/json' })
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
    let photos: Record<string, string>
    try {
      const parsed: unknown = JSON.parse(await file.text())
      next = normalizeHunt(parsed)
      // The photos block is untrusted file content — strict-validated, and only
      // ids the imported hunt actually references get stored.
      photos = validateBundlePhotos((parsed as { photos?: unknown })?.photos)
    } catch {
      alert("That file doesn't look like a MoveDay export.")
      return
    }
    const ok = confirm(
      `Replace "${hunt.name}" (${hunt.listings.length} listing${hunt.listings.length === 1 ? '' : 's'}) ` +
      `with "${next.name}" (${next.listings.length} listing${next.listings.length === 1 ? '' : 's'})? ` +
      'Your current hunt will be overwritten — Export it first if unsure.',
    )
    if (!ok) return
    const referenced = new Set(next.listings.flatMap((l) => l.photoIds))
    for (const [id, uri] of Object.entries(photos)) {
      if (referenced.has(id)) await addPhotoFromDataUri(id, uri)
    }
    update(() => next)
    void sweepOrphanPhotos([...referenced])
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
        <button onClick={() => setAnchorsOpen(true)}>
          📍 Anchors{hunt.anchors.length > 0 ? ` (${hunt.anchors.length})` : ''}
        </button>
        {hunt.listings.length > 0 && (
          <button onClick={() => setRecapOpen(true)} title="Your hunt, wrapped">📊 Recap</button>
        )}
        <div className="spacer" />
        {hunt.listings.length > 0 && (
          <button className="subtle" onClick={() => window.print()} title="Print a fill-in sheet for tour day">🖨 Tour sheet</button>
        )}
        <button className="subtle" onClick={exportHunt} title="Download this hunt as a JSON backup">Export</button>
        <button className="subtle" onClick={() => importRef.current?.click()} title="Restore a hunt from a JSON backup">Import</button>
        <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={onImportFile} />
        {supabaseEnabled && authReady && (
          user ? (
            <span className="account">
              <span
                className={'sync-dot ' + syncStatus}
                title={
                  syncStatus === 'error' ? 'Cloud sync failed — your hunt is still saved on this device'
                  : syncStatus === 'syncing' ? 'Saving to your account…'
                  : 'Synced to your account'
                }
              >
                {syncStatus === 'error' ? '⚠ Sync error' : syncStatus === 'syncing' ? '☁ Saving…' : '☁ Synced'}
              </span>
              <button className="subtle" onClick={() => void signOut()} title={user.email ?? undefined}>Sign out</button>
            </span>
          ) : (
            <button className="subtle" onClick={() => void signInWithGoogle()} title="Sync your hunt across devices">
              ☁ Sign in to sync
            </button>
          )
        )}
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
                {anchor0 && th(`→ ${anchor0.name}`, 'commute', true)}
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
                    {l.photoIds.length > 0 && (
                      <span className="photo-count" title={`${l.photoIds.length} photo${l.photoIds.length === 1 ? '' : 's'}`}>
                        📷{l.photoIds.length}
                      </span>
                    )}
                  </td>
                  <td><span className={'pill ' + l.status}>{l.status}</span></td>
                  <td className="num">{l.rentMonthly != null ? `$${l.rentMonthly.toLocaleString()}` : '—'}</td>
                  <td className="num">{l.sqft ?? '—'}</td>
                  <td className="num">{dollarsPerSqft(l) != null ? `$${dollarsPerSqft(l)!.toFixed(2)}` : '—'}</td>
                  <td><span className="stars">{l.tour?.rating ? '★'.repeat(l.tour.rating) : '—'}</span></td>
                  {anchor0 && (
                    <td className="num commute-cell">
                      {(() => {
                        const c = l.commutes.find((x) => x.anchorId === anchor0.id)
                        if (!c || c.driveMin == null) return '—'
                        return <span title={c.rough ? 'rough est. (straight-line)' : 'est. (OSRM)'}>🚗{c.driveMin}m{c.rough ? '~' : ''}</span>
                      })()}
                    </td>
                  )}
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
        {user
          ? 'Your hunt syncs to your account (photos stay on this device); Export bundles it all into one file.'
          : 'Everything stays on this device (localStorage + IndexedDB for photos); Export bundles it all into one file.'}
        {' '}Commute estimates are estimates — geocoding © OpenStreetMap
        contributors, routing by the OSRM demo server.
      </p>

      {editing && (
        <ListingDialog
          listing={editing === 'new' ? null : editing}
          anchors={hunt.anchors}
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

      {anchorsOpen && (
        <AnchorsDialog
          anchors={hunt.anchors}
          onChange={(anchors) => update((h) => ({ ...h, anchors }))}
          onClose={() => setAnchorsOpen(false)}
        />
      )}

      {recapOpen && <RecapDialog hunt={hunt} onClose={() => setRecapOpen(false)} />}

      {incomingPlan && (
        <IncomingPlanDialog
          incoming={incomingPlan}
          listings={hunt.listings}
          onAttach={attachPlan}
          onClose={() => setIncomingPlan(null)}
        />
      )}

      <TourSheet hunt={hunt} />
    </main>
  )
}

// ── Return trip: a plan arriving from Furnisher (#plan=) → attach it ─────────
// If the payload names a listing (round-trip from a Fit check) we offer that
// one directly; otherwise the user picks which listing it belongs to.
function IncomingPlanDialog({
  incoming, listings, onAttach, onClose,
}: {
  incoming: { name: string; plan: Record<string, unknown>; listingId?: string }
  listings: Listing[]
  onAttach: (listingId: string, plan: Record<string, unknown>) => void
  onClose: () => void
}) {
  const matched = incoming.listingId ? listings.find((l) => l.id === incoming.listingId) : undefined
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h2>Plan from Furnisher</h2>
        <div className="incoming-preview">
          <PlanMiniMap planJson={incoming.plan} maxHeight={200} />
        </div>
        {matched ? (
          <>
            <p className="incoming-msg">
              Attach <strong>{incoming.name}</strong> to <strong>{matched.name}</strong>
              {matched.planJson ? ' (replaces the plan already on it)' : ''}?
            </p>
            <div className="dialog-actions">
              <div className="spacer" />
              <button onClick={onClose}>Cancel</button>
              <button className="primary" onClick={() => onAttach(matched.id, incoming.plan)}>Attach</button>
            </div>
          </>
        ) : listings.length === 0 ? (
          <>
            <p className="incoming-msg">Add a listing first, then send the plan again to attach it.</p>
            <div className="dialog-actions">
              <div className="spacer" />
              <button className="primary" onClick={onClose}>OK</button>
            </div>
          </>
        ) : (
          <>
            <p className="incoming-msg">Which listing is this floor plan for?</p>
            <div className="incoming-pick">
              {listings.map((l) => (
                <button key={l.id} className="incoming-pick-row" onClick={() => onAttach(l.id, incoming.plan)}>
                  <span>{l.name}</span>
                  {!!l.planJson && <span className="incoming-has-plan">has a plan</span>}
                </button>
              ))}
            </div>
            <div className="dialog-actions">
              <div className="spacer" />
              <button onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── AI paste-parse (FABLE_BRIEF §5 M5a) ────────────────────────────
// Paste raw listing text → Claude fills the fields below. BYO Anthropic key,
// stored only in localStorage and sent straight to Anthropic from the browser.
function AiAutofill({ onFill }: { onFill: (p: ParsedListing) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [filledCount, setFilledCount] = useState<number | null>(null)
  const [hasKey, setHasKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')

  useEffect(() => { setHasKey(hasApiKey()) }, [])

  const saveKey = () => {
    if (!keyInput.trim()) return
    setApiKey(keyInput)
    setKeyInput('')
    setHasKey(true)
  }

  const run = async () => {
    if (!text.trim() || busy) return
    setBusy(true); setError(''); setFilledCount(null)
    try {
      const parsed = await parseListingText(text)
      onFill(parsed)
      setFilledCount(Object.keys(parsed).length)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Extraction failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="ai-autofill">
      <summary>✨ Autofill from pasted text</summary>
      <div className="ai-autofill-body">
        {!hasKey ? (
          <div className="ai-key">
            <p className="ai-note">
              Uses your own Anthropic API key to read a pasted listing and fill in the fields.
              The key is stored only in this browser and sent directly to Anthropic — never to a MoveDay server.
            </p>
            <div className="ai-key-row">
              <input
                type="password"
                value={keyInput}
                placeholder="sk-ant-…"
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveKey() }}
              />
              <button type="button" onClick={saveKey} disabled={!keyInput.trim()}>Save key</button>
            </div>
          </div>
        ) : (
          <>
            <textarea
              rows={4}
              value={text}
              placeholder="Paste the listing (Craigslist post, Zillow blurb, a landlord's email…) and I'll fill in rent, sqft, beds, address, and more below."
              onChange={(e) => setText(e.target.value)}
            />
            <div className="ai-autofill-actions">
              <button type="button" className="primary" onClick={() => void run()} disabled={busy || !text.trim()}>
                {busy ? 'Reading…' : '✨ Autofill'}
              </button>
              {filledCount !== null && !error && (
                <span className="ai-msg ok">{filledCount > 0 ? `Filled ${filledCount} field${filledCount === 1 ? '' : 's'} — review below.` : 'Nothing found to fill.'}</span>
              )}
              {error && <span className="ai-msg err">{error}</span>}
            </div>
          </>
        )}
      </div>
    </details>
  )
}

// ── Hunt recap — "wrapped" card (FABLE_BRIEF §5 M5b) ────────────────
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function RecapStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="recap-stat">
      <span className="recap-stat-label">{label}</span>
      <span className="recap-stat-value">{value}</span>
    </div>
  )
}

function RecapDialog({ hunt, onClose }: { hunt: Hunt; onClose: () => void }) {
  const r = useMemo(() => computeRecap(hunt), [hunt])
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog recap" onClick={(e) => e.stopPropagation()}>
        <h2>📦 Your hunt, wrapped</h2>
        <div className="recap-headline">
          {r.signed ? (
            <>
              <span className="recap-big">🎉 You signed {r.signed.name}</span>
              <span className="recap-sub">
                the {ordinal(r.signed.ordinalSeen)} place you saw
                {r.signed.daysHunting != null && ` · ${r.signed.daysHunting} day${r.signed.daysHunting === 1 ? '' : 's'} of hunting`}
              </span>
            </>
          ) : (
            <>
              <span className="recap-big">{r.toured} toured · {r.saved} saved</span>
              <span className="recap-sub">Still hunting — no lease signed yet. Keep going!</span>
            </>
          )}
        </div>
        <div className="recap-stats">
          <RecapStat label="Listings saved" value={String(r.saved)} />
          <RecapStat label="Toured" value={String(r.toured)} />
          {r.topRated && <RecapStat label="Top gut pick" value={`${r.topRated.name} · ${'★'.repeat(r.topRated.value)}`} />}
          {r.cheapest && <RecapStat label="Cheapest" value={`${r.cheapest.name} · $${r.cheapest.value.toLocaleString()}/mo`} />}
          {r.bestValue && <RecapStat label="Best $/sqft" value={`${r.bestValue.name} · $${r.bestValue.value.toFixed(2)}`} />}
          {r.avgRentToured != null && <RecapStat label="Avg rent (toured)" value={`$${r.avgRentToured.toLocaleString()}/mo`} />}
        </div>
        <div className="dialog-actions">
          <div className="spacer" />
          <button className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

// ── Tour-day sheet (FABLE_BRIEF §5 M5c) ────────────────────────────
// Print-only: hidden on screen, revealed by @media print (the 🖨 button calls
// window.print()). One fill-in card per active candidate — the facts you have,
// plus blanks for the gut check you'll only know once you're standing in it.
function TourSheet({ hunt }: { hunt: Hunt }) {
  const anchor0 = hunt.anchors[0]
  const cards = hunt.listings.filter((l) => l.status !== 'rejected' && l.status !== 'signed')
  if (cards.length === 0) return null
  return (
    <section className="tour-sheet" aria-hidden="true">
      <div className="tour-sheet-head">📦 MoveDay tour sheet — {hunt.name}</div>
      {cards.map((l) => {
        const psf = dollarsPerSqft(l)
        const c = anchor0 ? l.commutes.find((x) => x.anchorId === anchor0.id) : undefined
        return (
          <div className="tour-card" key={l.id}>
            <div className="tour-card-head">
              <span className="tour-card-name">{l.name}</span>
              <span className="tour-card-rent">{l.rentMonthly != null ? `$${l.rentMonthly.toLocaleString()}/mo` : ''}</span>
            </div>
            {l.address && <div className="tour-card-addr">{l.address}</div>}
            <div className="tour-card-facts">
              <span>Sqft: {l.sqft ?? '—'}</span>
              <span>$/sqft: {psf != null ? `$${psf.toFixed(2)}` : '—'}</span>
              <span>Beds: {l.beds ?? '—'}</span>
              <span>Baths: {l.baths ?? '—'}</span>
              <span>Avail: {l.availableFrom ?? '—'}</span>
              {anchor0 && <span>→ {anchor0.name}: {c?.driveMin != null ? `~${c.driveMin}m` : '—'}</span>}
            </div>
            <div className="tour-capture">
              <div className="tour-line"><span className="tour-lbl">Gut</span><span className="tour-stars">☆ ☆ ☆ ☆ ☆</span></div>
              <div className="tour-line"><span className="tour-lbl">Three words</span><span className="tour-blank" /></div>
              {hunt.dealbreakerDefs.length > 0 && (
                <div className="tour-line">
                  <span className="tour-lbl">Check</span>
                  <span className="tour-dbs">{hunt.dealbreakerDefs.map((d) => <span key={d.id} className="tour-db">☐ {d.label}</span>)}</span>
                </div>
              )}
              <div className="tour-notes"><span className="tour-lbl">Notes</span></div>
            </div>
          </div>
        )
      })}
    </section>
  )
}

// ── Add / edit dialog (includes post-tour capture) ─────────────────

function ListingDialog({
  listing, anchors, onSave, onDelete, onClose,
}: {
  listing: Listing | null
  anchors: Anchor[]
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
  // Merge AI-extracted fields over the draft. ParsedListing only carries keys the
  // model actually found, so spreading never clobbers a field with undefined.
  const applyParsed = (p: ParsedListing) => setDraft((d) => ({ ...d, ...p }))

  // ── Photos. Blobs live in IndexedDB; the dialog only holds object URLs.
  // Deletion is deferred so Cancel is safe: photos added this session are
  // deleted on Cancel, photos removed this session are deleted only on Save.
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const photoRef = useRef<HTMLInputElement>(null)
  const addedRef = useRef<string[]>([])
  const removedRef = useRef<string[]>([])
  const urlsRef = useRef<Record<string, string>>({})
  urlsRef.current = photoUrls

  useEffect(() => {
    let alive = true
    void (async () => {
      const fresh: Record<string, string> = {}
      for (const id of draft.photoIds) {
        if (urlsRef.current[id]) continue
        const blob = await getPhotoBlob(id)
        if (blob) fresh[id] = URL.createObjectURL(blob)
      }
      if (alive && Object.keys(fresh).length > 0) setPhotoUrls((p) => ({ ...p, ...fresh }))
    })()
    return () => { alive = false }
  }, [draft.photoIds])
  useEffect(() => () => { Object.values(urlsRef.current).forEach((u) => URL.revokeObjectURL(u)) }, [])

  const onAddPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    const room = MAX_PHOTOS_PER_LISTING - draft.photoIds.length
    if (files.length > room) alert(`Up to ${MAX_PHOTOS_PER_LISTING} photos per listing — adding the first ${Math.max(room, 0)}.`)
    setPhotoBusy(true)
    try {
      for (const f of files.slice(0, Math.max(room, 0))) {
        const id = await addPhotoFromFile(f)
        if (!id) continue
        addedRef.current.push(id)
        setDraft((d) => ({ ...d, photoIds: [...d.photoIds, id] }))
      }
    } finally {
      setPhotoBusy(false)
    }
  }

  const removePhoto = (id: string) => {
    setDraft((d) => ({ ...d, photoIds: d.photoIds.filter((p) => p !== id) }))
    if (lightbox === id) setLightbox(null)
    if (addedRef.current.includes(id)) {
      addedRef.current = addedRef.current.filter((x) => x !== id)
      void deletePhotos([id]) // never saved anywhere — safe to drop now
    } else {
      removedRef.current.push(id)
    }
  }

  const saveWithPhotoCleanup = () => {
    if (removedRef.current.length > 0) void deletePhotos(removedRef.current)
    onSave(draft)
  }
  const cancelWithPhotoCleanup = () => {
    if (addedRef.current.length > 0) void deletePhotos(addedRef.current)
    onClose()
  }

  return (
    <div className="overlay" onClick={cancelWithPhotoCleanup}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{listing ? 'Edit listing' : 'Add listing'}</h2>
        <AiAutofill onFill={applyParsed} />
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
            <label>Photos ({draft.photoIds.length}/{MAX_PHOTOS_PER_LISTING})</label>
            <div className="photo-strip">
              {draft.photoIds.map((id) => (
                <div className="photo-thumb" key={id}>
                  {photoUrls[id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrls[id]} alt="" onClick={() => setLightbox(id)} />
                  ) : (
                    <span className="photo-loading">…</span>
                  )}
                  <button type="button" className="photo-remove" title="Remove photo" aria-label="Remove photo" onClick={() => removePhoto(id)}>×</button>
                </div>
              ))}
              {draft.photoIds.length < MAX_PHOTOS_PER_LISTING && (
                <button type="button" className="photo-add" disabled={photoBusy} onClick={() => photoRef.current?.click()}>
                  {photoBusy ? '…' : '+ 📷'}
                </button>
              )}
              <input ref={photoRef} type="file" accept="image/*" multiple hidden onChange={onAddPhotos} />
            </div>
          </div>
          <div className="field full">
            <label>Commutes</label>
            <CommutesSection draft={draft} anchors={anchors} setDraft={setDraft} />
          </div>
          <div className="field full">
            <label>Floor plan (from Furnisher)</label>
            {draft.planJson ? (
              <div className="plan-attached">
                <PlanMiniMap planJson={draft.planJson} maxHeight={180} />
                <div className="plan-attached-foot">
                  <span>✓ Plan attached — 🛋️ Fit opens it in Furnisher with your furniture staged.</span>
                  <button type="button" className="subtle danger" onClick={() => set('planJson', undefined)}>Remove</button>
                </div>
              </div>
            ) : (
              <PlanPaste onAttach={(plan) => set('planJson', plan)} />
            )}
          </div>
        </div>
        <div className="dialog-actions">
          {onDelete && <button className="danger" onClick={() => { if (confirm('Delete this listing?')) { void deletePhotos(addedRef.current); onDelete() } }}>Delete</button>}
          <div className="spacer" />
          <button onClick={cancelWithPhotoCleanup}>Cancel</button>
          <button className="primary" disabled={!draft.name.trim()} onClick={saveWithPhotoCleanup}>Save</button>
        </div>
        {lightbox && photoUrls[lightbox] && (
          <div className="lightbox" onClick={() => setLightbox(null)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrls[lightbox]} alt="" />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Commutes (FABLE_BRIEF §5): OSRM estimates + fallback, manual transit ────

function CommutesSection({
  draft, anchors, setDraft,
}: {
  draft: Listing
  anchors: Anchor[]
  setDraft: React.Dispatch<React.SetStateAction<Listing>>
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  if (anchors.length === 0) {
    return (
      <p className="commute-hint">
        Add anchors (Work, Gym, a friend&apos;s place…) via 📍 Anchors in the toolbar, then
        estimate each listing&apos;s commute here.
      </p>
    )
  }

  const entryFor = (anchorId: string): CommuteEntry | undefined =>
    draft.commutes.find((c) => c.anchorId === anchorId)

  const upsertEntry = (entry: CommuteEntry) =>
    setDraft((d) => ({
      ...d,
      commutes: d.commutes.some((c) => c.anchorId === entry.anchorId)
        ? d.commutes.map((c) => (c.anchorId === entry.anchorId ? { ...c, ...entry } : c))
        : [...d.commutes, entry],
    }))

  const getEstimates = async () => {
    if (!draft.address?.trim()) {
      setNote('Add the listing address first.')
      return
    }
    setBusy(true)
    setNote('')
    try {
      // Geocode the listing once (Nominatim wants ≥1s between requests).
      let from = draft.lat != null && draft.lon != null ? { lat: draft.lat, lon: draft.lon } : null
      if (!from) {
        from = await geocode(draft.address)
        if (!from) {
          setNote("Couldn't find that address — check it and try again.")
          return
        }
        const { lat, lon } = from
        setDraft((d) => ({ ...d, lat, lon }))
      }
      const ready = anchors.filter((a) => a.lat != null && a.lon != null)
      for (const a of ready) {
        const to = { lat: a.lat!, lon: a.lon! }
        // Drive via OSRM; walk is ALWAYS the straight-line estimate — the OSRM
        // public demo routes every profile with the car graph (lib/commute.ts).
        const drive = await driveMinutes(from, to)
        upsertEntry({
          anchorId: a.id,
          driveMin: drive.minutes,
          walkMin: walkFallbackMinutes(from, to),
          transitMin: entryFor(a.id)?.transitMin,
          rough: drive.rough ? true : undefined,
        })
        await sleep(300) // gentle on the demo server
      }
      if (ready.length < anchors.length) {
        setNote(`${anchors.length - ready.length} anchor(s) have no location yet — open 📍 Anchors to retry their geocoding.`)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="commutes">
      {anchors.map((a) => {
        const c = entryFor(a.id)
        return (
          <div className="commute-row" key={a.id}>
            <span className="commute-name">{a.name}</span>
            <span className="commute-chips">
              {c?.driveMin != null && <span className="chip">🚗 {c.driveMin}m {c.rough ? 'rough est.' : 'est.'}</span>}
              {c?.walkMin != null && <span className="chip">🚶 {c.walkMin}m rough est.</span>}
              {c?.driveMin == null && c?.walkMin == null && <span className="chip empty">no estimate yet</span>}
            </span>
            <span className="commute-transit">
              🚇
              <input
                type="number"
                min="0"
                placeholder="min"
                value={c?.transitMin ?? ''}
                onChange={(e) => {
                  const v = e.target.value.trim() === '' ? undefined : Math.max(0, Number(e.target.value))
                  upsertEntry({ anchorId: a.id, ...entryFor(a.id), transitMin: Number.isFinite(v as number) ? v : undefined })
                }}
              />
              {draft.address && a.address && (
                <a
                  href={transitDeepLink(draft.address, a.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Check transit time on Google Maps, then type it in"
                >check ↗</a>
              )}
            </span>
          </div>
        )
      })}
      <div className="commute-actions">
        <button type="button" disabled={busy} onClick={getEstimates}>
          {busy ? 'Estimating…' : draft.commutes.length > 0 ? '↻ Refresh estimates' : 'Get estimates'}
        </button>
        {note && <span className="commute-note">{note}</span>}
      </div>
    </div>
  )
}

// ── Anchors manager (FABLE_BRIEF §5): the places your life happens ──────────

function AnchorsDialog({
  anchors, onChange, onClose,
}: {
  anchors: Anchor[]
  onChange: (anchors: Anchor[]) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const geocodeAnchor = async (list: Anchor[], id: string) => {
    const a = list.find((x) => x.id === id)
    if (!a || !a.address.trim()) return
    setBusyId(id)
    try {
      const hit = await geocode(a.address)
      onChange(list.map((x) => (x.id === id ? { ...x, lat: hit?.lat, lon: hit?.lon } : x)))
    } finally {
      setBusyId(null)
    }
  }

  const add = async () => {
    if (!name.trim() || !address.trim()) return
    const a: Anchor = {
      id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      address: address.trim(),
    }
    const next = [...anchors, a]
    onChange(next)
    setName('')
    setAddress('')
    await geocodeAnchor(next, a.id)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>📍 Anchors</h2>
        <p className="commute-hint">
          The places your life happens — every listing gets commute estimates against these.
        </p>
        {anchors.map((a) => (
          <div className="anchor-row" key={a.id}>
            <span className="anchor-name">{a.name}</span>
            <span className="anchor-addr">{a.address}</span>
            {a.lat != null && a.lon != null ? (
              <span className="anchor-ok" title={`${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}`}>✓ located</span>
            ) : (
              <button
                type="button"
                className="subtle"
                disabled={busyId === a.id}
                onClick={() => geocodeAnchor(anchors, a.id)}
              >{busyId === a.id ? '…' : '⚠ locate'}</button>
            )}
            <button
              type="button"
              className="subtle danger"
              title="Remove anchor"
              onClick={() => onChange(anchors.filter((x) => x.id !== a.id))}
            >×</button>
          </div>
        ))}
        {anchors.length === 0 && <p className="commute-hint">No anchors yet.</p>}
        <div className="anchor-add">
          <input placeholder="Name (Work)" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void add() }} />
          <button type="button" className="primary" disabled={!name.trim() || !address.trim()} onClick={() => void add()}>Add</button>
        </div>
        <p className="commute-hint">Geocoding by Nominatim © OpenStreetMap contributors.</p>
        <div className="dialog-actions">
          <div className="spacer" />
          <button onClick={onClose}>Done</button>
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
