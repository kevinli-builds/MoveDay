# MoveDay — Product / Engineering Brief

_Written 2026-07-11 by the Fable portfolio session. Audience: future Opus sessions
executing the build. This is the #1 "build" verdict from `~/PROJECT_IDEAS.md` —
the apartment-hunt companion that closes the loop with Furnisher. Everything here
was designed against Furnisher's actual code (`lib/types.ts`, `storage.ts`,
`warnings.ts` as of 2026-07-11), not from memory. Verify Furnisher's current state
before building the handoff (section 4)._

---

## 0. Status ledger (2026-07-11) + how to pick up

**Shipped ✓** — this brief; scaffold (M1 skeleton: data model, board, listing CRUD, local
persistence); repo on GitHub (kevinli-builds/MoveDay) + Vercel, LIVE at **`move-day.vercel.app`**
(NOTE: the bare `moveday.vercel.app` is a different, unrelated product — always use the hyphen);
**M2 the bridge (2026-07-11)** —
Furnisher side landed in that repo (`lib/share.ts`, `#import=` on mount, 🔗 copy-share-link; its
commit af41d16), MoveDay side = PlanPaste in the listing editor (accepts a Furnisher share link
OR raw plan JSON) feeding the existing 🛋️ Fit button → `composeFitCheckPlan` → Furnisher.
**Next → (build order)** — finish M1 (photos via IndexedDB, export/import bundle);
M3 commute anchors; M4 mini plan renderer + `myFurniture` manager (the Fit button currently
stages an EMPTY furniture list until the manager exists — build it early in M4) + `#plan=`
return route; M5 extras (AI paste-parse first).
**House rules** — local-first, no accounts, no backend in MVP; label every
estimate; never scrape listing sites (§9); commit + push per portfolio convention.

---

## 1. Product thesis

Apartment hunting is a 2–6 week sprint of high-stakes, low-tooling decisions.
People tour 5–15 units and compare them in Notes apps and memory — and memory
fails after the third tour ("which one had the weird kitchen?"). Every listing
site optimizes for *discovery*; nothing owns *evaluation*: the shortlist, the
tour notes, the commute math, and the one question nobody else can answer —
**"will my actual furniture fit, and will it physically get through the door?"**

That last question is the moat. Furnisher already owns the hard parts: a real
plan geometry model, AI blueprint import, collision + clearance checking, and a
Doorway Test that computes whether each piece can route from outside to its room.
MoveDay is the front half of that story: capture listings as you hunt, compare
them honestly, and hand any floor plan to Furnisher for the fit verdict.

**User:** one person (or couple) actively hunting. Usage is seasonal and intense —
design for a 4-week burst, not daily retention. Success = they sign a lease
having *used the board to decide*, and the Furnisher halo ("it told me the couch
wouldn't make the stairwell turn") is the story they tell.

## 2. MVP definition + cut-lines

**In (MVP):**
- Listing capture: manual entry (address, rent, sqft, beds/baths, URL, notes) —
  fast form, under 30 seconds per listing.
- Photos per listing (camera roll upload, stored locally in IndexedDB).
- The comparison board: listings × criteria table, sortable, with status pills
  (saved → touring → toured → applied → rejected / signed).
- Tour mode: gut rating (1–5) + "three words" free text + dealbreaker checklist,
  captured right after a viewing.
- Commute chips per listing against user-defined anchors (§5).
- Furnisher handoff: per-listing floor plan JSON + "Check my furniture fits" (§4).
- Export/import of the whole hunt as one JSON bundle (backup / device move).

**Out (explicitly, with reasons):**
- **Scraping listing sites** — legal/maintenance tarpit (PROJECT_IDEAS verdict
  stands). Paste-first forever; the AI paste-parse (§7 M5) recovers the magic.
- **Accounts / backend / sync** in MVP — a hunt is single-user and short-lived;
  localStorage + IndexedDB + export bundle covers it. Supabase phase 2 (§6).
- **Map view of listings** — a nice-to-have; commute chips answer the real
  question ("how far from my life"), a map answers a fake one. Revisit post-MVP.
- **Weighted scoring formulas** — sortable columns + a pinned favorite beat a
  fake-precise score. Revisit only on real use.

## 3. Data model (TypeScript, `lib/types.ts` in this repo)

```ts
export type ListingStatus = 'saved' | 'touring' | 'toured' | 'applied' | 'rejected' | 'signed'

export interface Anchor {           // a place your life happens
  id: string
  name: string                      // "Work", "Gym", "Sam's place"
  address: string
  lat?: number; lon?: number        // geocoded once, cached (§5)
}

export interface CommuteEntry {
  anchorId: string
  driveMin?: number                 // OSRM estimate (labelled "est.")
  walkMin?: number                  // OSRM estimate
  transitMin?: number               // MANUAL — user reads it off Google Maps
                                    // (deep link provided; we never scrape)
}

export interface TourNotes {
  rating?: 1 | 2 | 3 | 4 | 5        // gut rating, captured post-tour
  threeWords?: string               // "bright, tiny kitchen, street noise"
  touredAt?: string                 // ISO date
  dealbreakers?: Record<string, boolean> // keyed by DealbreakerDef.id
}

export interface Listing {
  id: string
  createdAt: string
  status: ListingStatus
  name: string                      // "Maple St 2BR"
  address?: string
  url?: string                      // listing page (safeUrl-validated)
  rentMonthly?: number              // USD
  sqft?: number
  beds?: number; baths?: number
  floor?: number; hasElevator?: boolean   // feeds the Furnisher stairs story
  availableFrom?: string            // ISO date
  notes?: string
  photoIds: string[]                // IndexedDB keys (blobs never in localStorage)
  commutes: CommuteEntry[]
  tour?: TourNotes
  planJson?: unknown                // a Furnisher Partial<Plan> — treated as
                                    // UNTRUSTED on load (see §4 security)
  pinned?: boolean                  // the current favorite
}

export interface Hunt {             // the root persisted object (one active hunt)
  v: 1
  name: string                      // "Fall 2026 move"
  anchors: Anchor[]
  dealbreakerDefs: { id: string; label: string }[]  // user-configurable checklist
  myFurniture: FurnTemplate[]       // Furnisher's template shape, verbatim (§4)
  listings: Listing[]
}
```

Derived, never stored: `$/sqft`, per-anchor commute deltas, fit-check status
(recomputed from `planJson` presence + last handoff result).

**Persistence:** `Hunt` in `localStorage['moveday.hunt.v1']` through a
`normalizeHunt()` trust boundary (Furnisher's `normalizePlan` pattern — every
loaded/imported hunt passes through it; unknown fields dropped, colors/urls
sanitized). Photos as Blobs in IndexedDB (`idb-keyval`, store `moveday-photos`),
keyed by `photoIds`. The export bundle inlines photos as base64 data-URIs, capped
at ~1.5 MB per photo (canvas re-encode on import/upload — apartments photos don't
need originals).

## 4. The Furnisher handoff (the technical core)

Two apps on different origins (`move-day.vercel.app` ↔ `furnisher.vercel.app`)
can't share localStorage, and Furnisher is a static export with no server. The
bridge is the **URL fragment**: plan JSON, lz-string-compressed, carried in
`#…` — fragments never hit server logs or Referer headers, and comfortably carry
the 2–10 KB a rooms-and-doors plan compresses to.

### Payload format (versioned, both directions)

```ts
// lz-string compressToEncodedURIComponent(JSON.stringify(payload))
interface HandoffPayload {
  v: 1
  source: 'moveday' | 'furnisher'
  name: string                      // listing/plan display name
  listingId?: string                // round-trip correlation (moveday → furnisher → back)
  plan: Partial<Plan>               // Furnisher's Plan shape; receiver normalizes
}
```

### MoveDay → Furnisher: "Check my furniture fits"

MoveDay composes a plan: the listing's `planJson` (rooms/doors/stairs) **plus
`myFurniture` staged as placed pieces in a row below the plan's bounding box**
(unrotated, 20 cm gaps — a loading dock). Opens
`https://furnisher.vercel.app/#import=<packed>`. The user drags pieces in;
Furnisher's existing warnings, clearance checker, and Doorway Test do the rest.
That composition is the whole feature — Furnisher answers "does it fit" with
code it already has.

### Furnisher-side change (small PR to the Furnisher repo — spec)

On mount in `page.tsx`, before the saved-plan load:
1. Read `location.hash`; match `#import=<packed>`.
2. Decompress + parse; **feed through `normalizePlan()`** — the existing trust
   boundary already sanitizes colors (`safeColorField`) exactly because plans
   from elsewhere are untrusted. Reject (toast + clear hash) on parse failure.
3. Confirm dialog: _"Import '⟨name⟩'? Your current plan is saved to your
   library first."_ — save current plan to the library (`lib/library.ts`
   exists), adopt the imported plan, clear the hash via
   `history.replaceState` (so refresh doesn't re-prompt).
4. Add "Copy share link" (same encoding, `source:'furnisher'`) to the account
   menu / stats panel.

Step 4 is why this PR carries its own weight: **it ships Furnisher's parked P2
"share links" feature** — any plan becomes a sendable URL, MoveDay is just one
sender. Frame the commit that way.

Size guard: if `packed.length > ~30_000` (huge furnished plans), fall back to
"Copy plan JSON" + paste-import in the receiving app (an `ImportModal` textarea
tab on both sides). Rooms-only handoffs from MoveDay will never hit this.

### Furnisher → MoveDay (return trip + plan capture) — build in M4, degrade gracefully

Same mechanism reversed: `https://<moveday>/#plan=<packed>`. If the payload has
a `listingId`, attach to that listing; else offer "attach to…" picker. Until the
Furnisher-side "send to MoveDay" button exists, MoveDay accepts **pasted plan
JSON** in the listing editor (textarea → normalize → store) — so the flow works
day one: import blueprint in Furnisher (AI import exists there), copy JSON via
the share-link "Copy plan JSON" fallback, paste into MoveDay.

### Security

- Inbound `#plan=` payloads are untrusted: MoveDay runs its own normalize pass;
  the only place plan data renders is the read-only SVG mini-map (§6), and any
  color field goes through a `SAFE_COLOR`-style allowlist copied from
  Furnisher's `lib/sanitize.ts` (same attack: `color:"url(…)"` in an SVG fill
  makes the viewer's browser fetch an attacker URL).
- `url` fields render as links only through a copied `safeUrl()` (http/https only).
- No `postMessage`, no iframes, no shared storage — the fragment handoff keeps
  the trust story one-directional and auditable.

## 5. Commutes without a paid API (honest free-tier design)

- **Geocoding:** Nominatim (`nominatim.openstreetmap.org/search`) — free,
  1 req/s, requires a descriptive `User-Agent`/`Referer` and result caching.
  Geocode on address save (listing + anchor), cache `lat/lon` in the entity,
  never re-query unless the address changes. Attribution "© OpenStreetMap" in
  the footer.
- **Drive/walk estimates:** OSRM public demo server
  (`router.project-osrm.org/route/v1/{driving|foot}/…`) — free, no key, **no
  SLA**. Wrap in a 5 s timeout; on failure show "est. unavailable" and fall
  back to straight-line distance × mode factor, labelled _"rough est."_. Every
  number renders with an "est." suffix — house rule: label estimates.
- **Transit:** no free transit API is worth its setup cost. Provide a
  one-tap deep link —
  `google.com/maps/dir/?api=1&origin=⟨listing⟩&destination=⟨anchor⟩&travelmode=transit`
  — and a manual minutes field next to it. The user reads the number off
  Google Maps once; we store it. Honest > magical-but-fake.

## 6. Architecture & stack

- **Next.js 16 App Router, static export, TypeScript, React 19** — Furnisher's
  exact stack (conventions transfer; so do future maintainers' habits).
- Hand-written CSS in `app/globals.css`, its own identity: **kraft-cardboard
  palette** (moving-box tan `#c9a87c`, packing-tape blue `#3d6b9e` accent, warm
  off-white ground) — visibly a sibling of Furnisher's earthy scheme, not a clone.
- Dev port **3006** (3002 Furnisher, 3005 PersonalAssist, 3010 EnergyMap).
- No backend, no env vars, no secrets in MVP. Deploy = Vercel static.
- **Phase 2 (only on real demand):** cross-device sync / partner sharing via
  Supabase on **Furnisher's existing project in a dedicated `moveday` Postgres
  schema** — the PersonalAssist precedent (free tier caps projects at 2; both
  slots are taken). RLS own-rows, anon key only.
- Tests: vitest on the pure seams — `normalizeHunt`, handoff encode/decode
  round-trip, commute fallback math, `$/sqft` derivations. Same trust-boundary
  test style as Furnisher's `storage.test.ts`.

## 7. Build order (each milestone independently shippable)

- **M1 — The board** ✓ scaffolded: types + `normalizeHunt` + storage; board
  page (table, status pills, sort, pin); listing add/edit; tour-notes capture.
  _Remaining in M1: IndexedDB photos; export/import bundle._
- **M2 — The bridge:** Furnisher-side `#import=` PR (spec §4 — do this in the
  Furnisher repo, clean tree, its own commit narrative); MoveDay "Open in
  Furnisher" + paste-import of plan JSON.
- **M3 — Commutes:** anchors CRUD, Nominatim geocode-on-save, OSRM chips with
  fallback, transit deep link + manual field.
- **M4 — Fit story complete:** SVG mini-map of `planJson` (rooms + doors,
  read-only, ~80 lines); `myFurniture` manager (import from pasted Furnisher
  plan/inventory JSON); staged-composition handoff; `#plan=` return route.
- **M5 — Delight & leverage (in order):** (a) **AI paste-parse** — paste raw
  listing text → BYO Anthropic key (Furnisher's `anthropic.ts` localStorage
  pattern, claude-haiku) extracts rent/sqft/beds/address into the form — the
  scraping magic without the scraping; (b) hunt retrospective card ("12 toured,
  you signed the 3rd one you saw") — the portfolio's wrapped streak; (c) print
  CSS for a tour-day sheet.

## 8. Open questions for the user (none block M1–M3)

1. Couple-mode (two gut ratings per tour) — worth it, or single-rater?
2. Should "signed" archive the hunt into a keepsake (feeds M5b)?
3. Domain/name check: is `MoveDay` final? (Repo name locks in at first push.)

## 9. Risks & tarpits (standing decisions)

- **Never scrape listing sites** — ToS + selector-rot tarpit. Paste-first is a
  feature: 30-second capture beats a broken importer.
- **OSRM demo has no SLA** — the fallback path (§5) is not optional polish; it
  ships with M3 or M3 doesn't ship.
- **Fragment payloads appear in browser history** — acceptable (same-device,
  plan geometry only, no PII beyond an address the user typed). Do not ever put
  photos or notes into a handoff payload.
- **Seasonality is fine** — this is a tool you reach for hard then shelve; do
  not add retention mechanics to fight its nature.

---

## Security & code-quality audit (2026-07-12, Fable portfolio pass)

_New repo, M1 skeleton, PUBLIC. **Security surface is minimal by design** —
local-first, no backend, no accounts, no secrets. Nothing sensitive to record
privately. Verified the trust boundary is already right:_

- `app/lib/sanitize.ts` (`safeColor` hex-allowlist blocks `url(...)` exfiltration;
  `safeUrl` http(s)-only blocks `javascript:`/`data:`) is present and **wired into
  `normalizeHunt()`** (`storage.ts`), which every loaded/imported hunt passes
  through. This mirrors Furnisher's proven pattern — good instinct to copy it.

**MD1 — carry the trust boundary into the M2 Furnisher handoff when you build it.**
The inbound side (redeeming a `#import=` lz-string payload from Furnisher, and
Furnisher redeeming MoveDay's) is attacker-controllable (anyone can craft a URL
fragment). Ensure the unpack path runs the decoded object through `normalizeHunt()`
/ the Furnisher-side equivalent **before** any field reaches a color, href, or SVG
sink — don't trust `lz-string`-decoded JSON just because it "came from the other
app." The brief already flags geometry is Furnisher's Plan shape; add "and passes
Furnisher's `normalizePlan` on arrival" to the §4 protocol.

**Quality:** already has vitest on the trust boundary + handoff — keep that bar as
M1→M5 fill in. No other issues at this size.
