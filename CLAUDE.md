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
- **Local-first, no backend, no secrets**: Hunt in `localStorage['moveday.hunt.v1']`,
  photos in IndexedDB (`idb-keyval`, M1 remaining). `lz-string` for URL-fragment
  handoffs.
- Every loaded/imported hunt passes through `normalizeHunt()` (`app/lib/storage.ts`)
  — the trust boundary. Colors → `safeColor`, links → `safeUrl` (`app/lib/sanitize.ts`).

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

## Status (2026-07-11)
M1 skeleton built (board, listing CRUD, tour capture, persistence, tests).
Not yet: photos (IndexedDB), export bundle, Furnisher-side `#import=` (M2),
commutes (M3), mini plan renderer + furniture manager (M4).

## Git / deploy
- **GitHub**: https://github.com/kevinli-builds/MoveDay (branch `main`)
- Not yet deployed — when ready, import in Vercel (Next.js preset, static
  export, no env vars needed) and add a Personal Site card per that repo's
  conventions (GitHub badge now, Live badge once deployed).
