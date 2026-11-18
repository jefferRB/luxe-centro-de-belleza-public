# Requirements

How the client's brief was turned into requirements, and where each one stands in this
repository. The original documents (product specification, requirements, business rules and an
architecture plan, all dated October 2026) are private; this is an anonymised summary.
Business data such as prices, contact details beyond the public links, and internal notes is
deliberately left out.

## Process

1. **Evidence from the business.** Photos of the studio, a short exterior video and screenshots
   of the booking platform's public service list. These were treated as *design reference*, not
   as content cleared for publication.
2. **Product specification.** Vision, audiences, art direction, information architecture, the
   narrative of each section, device behaviour, scope and the approvals needed before launch.
3. **Requirements.** 32 functional (`RF`) and 24 non-functional (`RNF`) items, each with a
   priority (`M` must, `S` should, `F` future) and the evidence that accepts it, plus twelve
   *Given / When / Then* acceptance scenarios and a traceability matrix.
4. **Business rules.** How booking, loyalty and reviews stay on the booking platform, how
   domains and local SEO are handled, and what may never be invented.
5. **Architecture plan.** Initial decisions, a proposed repository structure, a test plan and
   work packages.

### Information states

Every fact about the business was classified before it could be used:

| State | Meaning | In the code |
|---|---|---|
| Confirmed | Received and approved by the business | `{ status: 'confirmed', value, source, reviewedAt }` |
| Observed | Seen in a photo, video or screenshot; not validated | Not shipped |
| Proposed | Copy or design waiting for approval | Not shipped as fact |
| Pending | Unknown; never filled with placeholder data | `{ status: 'pending' }` |

[`src/data/luxe.ts`](../src/data/luxe.ts) applies this to the domain, every contact channel,
the address (locality level only), the opening hours and each booking-platform module. The same
idea later shaped the media publication policy ([media-policy.md](media-policy.md)).

## Requirement → implementation

| Requirement (summarised) | Priority | Implementation | Verified by |
|---|---|---|---|
| Brand, `h1` and primary booking call readable on mobile | M | Static hero; booking in header, hero and action dock | `hero.spec.ts`, `verify-build.ts` (single `h1`, booking reachable from three places) |
| Scissors intro, once, never blocking | M | Synchronous gate before first paint, 1.5 s, once per session ([`ScissorsIntro.astro`](../src/components/hero/ScissorsIntro.astro), [`intro.ts`](../src/scripts/intro.ts)) | `intro.test.ts`, `hero.spec.ts` |
| Respect reduced motion | M | Intro skipped; globe, crowns and camera stop animating | `espacio-orbital.spec.ts`, `mundo-luxe.spec.ts`, `hero.spec.ts` |
| Content without JavaScript | M | Prerendered HTML; first work and crown pose server-rendered; `<noscript>` images on the globe | `phase4-regressions.spec.ts` (scripts blocked) |
| Accessible navigation, visible focus | M | Landmarks, tablists, keyboard paths in every experience | e2e keyboard tests |
| Booking through the platform's public URL | M | URL built from a validated slug ([`drago.ts`](../src/lib/drago.ts)) | `drago.test.ts`, `links.test.ts`, `verify-build.ts` |
| Mobile booking call visible and not intrusive | M | Fixed dock: side rail on desktop, opaque bottom bar on small screens | `phase4.spec.ts` (dock never covers a focused control) |
| Services by confirmed categories | M | One taxonomy for services, globe and gallery ([`services.ts`](../src/data/services.ts)) | `media.test.ts`, `globe.test.ts` |
| Prices only when verified | M | No prices on the site | `phase4-regressions.spec.ts` (no currency in `main`) |
| The space shown with authentic, authorised photos | M | Space tour + publication policy; demo media in this repository | `media.test.ts`, `media-policy.test.ts` |
| Loyalty and reviews links | M | Modules still *pending*; they cannot ship until confirmed | `verify-build.ts` |
| Maps, hours (Costa Rica time) and contact | M | Confirmed links; live "open now" status in `America/Costa_Rica` | `opening-hours.test.ts`, `phase4.spec.ts` |
| Title, description, Open Graph, canonical, sitemap, robots | M | [`BaseLayout.astro`](../src/layouts/BaseLayout.astro), [`sitemap.xml.ts`](../src/pages/sitemap.xml.ts) | `verify-build.ts` |
| `LocalBusiness` structured data with real data only | M | `BeautySalon` and `WebSite` JSON-LD ([`structured-data.ts`](../src/data/structured-data.ts)) | `orbit.test.ts`, `phase4.spec.ts` |
| Gallery by category with accessible navigation | S | Works crown with a tablist ([`showcase.ts`](../src/scripts/showcase.ts)) | `showcase.test.ts`, `phase4.spec.ts` |
| Responsive 320–1920 px and 200 % zoom | M | Mobile-first layout; desktop "scenes" only above 64 rem × 34 rem | `phase4.spec.ts` (reflow), `espacio-orbital.spec.ts` |
| No secrets or personal data exposed | M | Static public site; admin config server-side only | `verify-build.ts`, `media-policy.test.ts` |
| No credentials or database access to the booking platform | M | Links only | code review, `links.test.ts` |
| Traceable contact and price data | M | `Confirmation<T>` with source and review date | `drago.test.ts` |
| Reproducible builds and audited dependencies | M | Lockfile, CI workflow, `npm audit` | CI |
| Content separated from layout | S | `src/data/*` drive every section | — |

### Not implemented in this repository

Some first-version items do not exist in the current code. Whether they were dropped, deferred or
handled elsewhere needs the author's confirmation:

- A custom 404 page and a privacy page (the reference nginx config answers `404` for unknown paths).
- Privacy-friendly conversion analytics.
- Loyalty and review sections (their platform modules were never confirmed).

## Scope changes during the project

| First specification | Current implementation | Notes |
|---|---|---|
| No admin panel and no CMS | Private photo admin with a publishing pipeline | Added in the last development phase. *Motivation to be confirmed.* |
| "No heavy 3D animations" | CSS 3D globe, crown and orbital camera | Built without WebGL or a 3D library and with reduced-motion paths; the project notes record WebGL/Three.js as considered and set aside. |
| Static hosting on a managed platform | nginx + a Node process for `/admin` | The admin needs a server. *Confirm whether this was the reason.* |
| Animation library only if a prototype proved it necessary | No animation library | CSS, the Web Animations API and `requestAnimationFrame`. |

## Decisions recorded in the brief

These come from the architecture plan written before development, not reconstructed afterwards:

- **Prerendered Astro + strict TypeScript.** The site is about content, SEO and photography. A
  full React SPA (more JavaScript than the purpose needed), WordPress (maintenance and attack
  surface) and a server application hosted next to the booking platform (operational load) were
  set aside for the first version.
- **Integrate the booking platform by links, not an API.** Less duplication, no tenant or data
  exposure, and no second booking implementation. An API was left as a future option with
  explicit requirements.
- **Progressive animation.** Complete HTML first; no JavaScript or reduced motion removes the
  intro layer; nothing blocks input.
- **Typed, approved editorial data** in `src/data/`, with no invented contact data, hours or address.
