# Case study: the editorial portfolio

<p align="center"><img src="../../showcase/production/gallery.webp" alt="The works section in production: category tabs with counts, a haircut photograph large in the centre of the 3D crown with nail work curving away on both sides, and its title, description, counter, booking button and «Ver en grande» button." width="100%"></p>
<p align="center"><sub>Production site.</sub></p>

Section 02, *«El resultado habla por sí solo.»*, presents the studio's work: 23 photographs
across five categories in production. A clone of this repository shows generated illustrations
in the same slots, with the same proportions.

## Goals

- One piece in focus at a time, with its own title, short description and a booking button
  worded for its category ("Reservar mi corte", "Reservar mi cita").
- The whole archive one step away, filtered by category.
- Never stretch or crop a result in a way that hides the work.

## Structure

| Piece | File |
|---|---|
| Data: catalog → portfolio items, category list with counts, per-work copy | [`src/data/portfolio.ts`](../../src/data/portfolio.ts) |
| State: sequence per category, circular index, counter | [`src/lib/showcase-state.ts`](../../src/lib/showcase-state.ts) |
| Geometry: pose of each card by offset, drag unit, settle and swipe targets, tween timing | [`src/lib/orbit-layout.ts`](../../src/lib/orbit-layout.ts) |
| Crown controller: transforms at most once per frame, idle when still | [`src/scripts/orbit-stage.ts`](../../src/scripts/orbit-stage.ts) |
| Section behaviour: filters, arrows, swipe, counter, viewer | [`src/scripts/showcase.ts`](../../src/scripts/showcase.ts) |
| Markup and first work rendered on the server | [`LuxeShowcase.astro`](../../src/components/sections/LuxeShowcase.astro), [`ShowcasePhoto.astro`](../../src/components/sections/ShowcasePhoto.astro) |
| Shared viewer | [`src/scripts/lightbox.ts`](../../src/scripts/lightbox.ts) |

The build fails if a work has no reviewed copy (`buildPortfolio` throws), so a new photo cannot
appear with an empty or placeholder caption.

## Interaction

- **Filters:** a tablist with counts; arrows, Home and End move focus and selection. A category
  with no publishable work is not rendered.
- **Navigation:** previous/next buttons, keyboard, swipe on touch, mouse drag, or a click on a
  neighbour. All of them move one continuous position; release picks a whole card
  (`settleTarget`, `swipeTarget`), so the crown never rests between two works.
- **Viewer:** *«Ver en grande»* opens a `<dialog>` with a focus trap and returns focus to the
  button that opened it.
- **Progressive enhancement:** without JavaScript the first work, its text and the booking link
  are already in the HTML; the script adds the crown.

## Responsive behaviour

On desktop the crown and the text sit side by side inside a full-height "scene" (only above
64 rem × 34 rem; below that the page flows normally). On phones the tabs scroll horizontally and
the crown stacks above the text. Tall images use a focal point per work (`objectPosition`) so
fixed frames show the result rather than an arbitrary centre.

## Testing

- `tests/showcase.test.ts`: catalog order, categories and counts, copy for every work, the empty
  build when nothing is approved, counter formatting and wrapping.
- `tests/orbit.test.ts`: crown poses, settle and swipe targets.
- `tests/e2e/phase4.spec.ts`, `phase43.spec.ts`, `tactil.spec.ts`: filters, keyboard, swipe,
  drag, aspect ratios kept, the full-size image in the viewer, 320 px and 200 % zoom.

## Why a crown and not a grid

A grid shows everything at once at thumbnail size. The crown gives each piece the full width of
the section and a sentence about it, which suits a studio whose work is the main argument, while
the tabs keep any category one step away.
