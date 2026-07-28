# MoveDay — Claude Context

## Notes & handoff — READ FIRST when told to "go through your notes"
**`FABLE_BRIEF.md`** (repo root) is the roadmap of record — product thesis, MVP
cut-lines, data model, the Furnisher handoff protocol (§4, spans BOTH repos),
commute design, build order (M1–M5), and a **status ledger at the top**. When
asked to pick up the next enhancement: (1) read the brief; (2) run
`git log --oneline -20` + `git status` — a dirty working tree means another agent
is mid-flight; (3) confirm the item is not already built; (4) build it with the
house conventions (tests, then commit + push).

## Concept
The apartment-hunt companion — capture listings as you tour, compare them on one
board, remember what each unit felt like, and hand any floor plan to **Furnisher**
(`C:\Users\snoww\Furnisher`, furnisher.vercel.app) to check your actual furniture
fits. The #1 "build" verdict in `~/PROJECT_IDEAS.md`.

## Stack
- **Next.js 16** (App Router, static export), **React 19**, **TypeScript** —
  Furnisher's stack; conventions transfer.
- Hand-written CSS in `app/globals.css` — kraft-cardboard palette (box tan
  `#c9a87c`, packing-tape blue `#3d6b9e`).
- **Local-first**: Hunt in `localStorage['moveday.hunt.v1']`, photos in IndexedDB
  (`idb-keyval`). `lz-string` for URL-fragment handoffs. The app runs fully local
  with no account.
- **Optional cloud sync** (M6, added 2026-07-28): when the two `NEXT_PUBLIC_SUPABASE_*`
  env vars are set, a "☁ Sign in to sync" button appears (Google OAuth). The whole
  hunt is one JSONB row per user in `public.moveday_hunts` on the shared **Central DB**
  project (ref `tmycdgnofvmbyrmpqohw`; migration `supabase/01-moveday-hunts.sql`),
  last-write-wins, own-row RLS. **Photos are NOT synced** (they stay in IndexedDB —
  a synced hunt's photoIds only resolve on the device holding the blobs).
  Client seams: `app/lib/supabase.ts` / `auth.ts` / `cloud.ts` (adapted from
  Furnisher). Anon key only — safe in the browser; never ship service_role.
- Every loaded/imported/**pulled** hunt passes through `normalizeHunt()`
  (`app/lib/storage.ts`) — the trust boundary. Cloud data is untrusted like an
  import. Colors → `safeColor`, links → `safeUrl` (`app/lib/sanitize.ts`).

## Run / dev
```
npm.cmd install          # PowerShell: use npm.cmd
npm.cmd run dev          # http://localhost:3006
npm.cmd run typecheck    # tsc --noEmit
npm.cmd run test         # vitest (lib/ trust boundary + handoff)
npm.cmd run build        # static export
```

## Architecture
```
app/
├── page.tsx             Root client component: board table, sort, pin, add/edit
│                        dialog (incl. post-tour gut rating + "three words")
├── layout.tsx, globals.css
└── lib/
    ├── types.ts         Hunt / Listing / Anchor / TourNotes / FurnTemplate
    ├── storage.ts       defaultHunt / normalizeHunt (TRUST BOUNDARY) / load / save
    ├── handoff.ts       pack/unpack lz-string payloads; composeFitCheckPlan
    │                    (stages myFurniture below the plan); furnisherImportUrl
    ├── sanitize.ts      safeColor (SVG sinks) + safeUrl (hrefs)
    └── __tests__/       vitest — hostile-input coercion + handoff round-trips
```

## Conventions
- Commit and push without asking; end commit messages with the Co-Authored-By line.
- Label every estimate ("est.") — commute numbers are never presented as exact.
- **Never scrape listing sites** (FABLE_BRIEF §9) — paste-first forever.
- Geometry in the handoff payloads is Furnisher's Plan shape, centimetres.

## Status (2026-07-28)
M1 board, photos (IndexedDB), export/import bundle, commutes, mini plan renderer +
furniture manager all shipped. **M6 optional cloud sync** (see Stack). **M5 delight
shipped 2026-07-28**: (a) AI paste-parse (`lib/anthropic.ts` — BYO Anthropic key,
claude-haiku-4-5, "✨ Autofill from pasted text" in the listing dialog), (b) hunt
recap (`lib/recap.ts` pure + tested; 📊 Recap dialog), (c) tour-day print sheet
(print-only `TourSheet` + `@media print`; 🖨 button). M1–M6 all shipped; 50 tests.
Sync needs one Kevin-side dashboard step: add MoveDay's origins to Central DB →
Auth → URL Configuration → Redirect URLs (`http://localhost:3006/**` +
`https://move-day.vercel.app/**`), and set the two env vars in Vercel for prod.

## Git / deploy
- **GitHub**: https://github.com/kevinli-builds/MoveDay (branch `main`)
- **Live**: https://move-day.vercel.app (Vercel, Next.js static export, no env
  vars). ⚠️ Use the **hyphenated** URL — the bare `moveday.vercel.app` is a
  different, unrelated product. The repo `homepage` is set to the correct URL.
- On the Personal Site as a project card (Live + GitHub badges) as of 2026-07-12.
