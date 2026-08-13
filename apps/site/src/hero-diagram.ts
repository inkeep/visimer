/**
 * The hero headline, and the static stand-in that holds its place until mermaid
 * has drawn the real one.
 *
 * The headline is a live diagram, which means it cannot exist until the app
 * bundle has downloaded, React has mounted, mermaid has pulled its flowchart
 * renderer over further round trips, and a layout pass has run. Left alone that
 * is about a second of fully-drawn page with a 300px hole where the h1 belongs,
 * and a pop when it lands.
 *
 * The stand-in below closes that window. It is hand-drawn SVG rather than a
 * captured render so it stays readable and reviewable, but its viewBox and every
 * coordinate in it are mermaid's own output for `HERO_SOURCE_*`. Matching the
 * viewBox is what makes the swap invisible: both are fitted into the same box by
 * the same `preserveAspectRatio`, so the glyphs land on the same pixels at every
 * window size, and the crossfade has nothing left to hide.
 *
 * One definition, two consumers: the module is imported by App.tsx for the React
 * hero and by vite.config.ts, which inlines `heroBootHtml()` into index.html at
 * build time so the stand-in is in the served document — painted before any
 * JavaScript runs, and still the only headline a visitor without JavaScript sees.
 *
 * The coordinates are a function of four things, so changing ANY of them means
 * re-deriving: the label strings below, `heroConfig.flowchart` in App.tsx
 * (padding / nodeSpacing / rankSpacing), the Inter face the labels are measured
 * in, and the pinned mermaid version. Re-measure by reading `.hero-masthead svg`
 * off the running site.
 *
 * When re-measuring, note that mermaid measures its labels exactly once, so it
 * emits a ~2% tighter layout whenever it happens to render before Inter has
 * loaded — sample until you see the wider of the two. These are the Inter-loaded
 * numbers, which is what a real visitor gets: the font stylesheet is
 * preconnected and lands an order of magnitude sooner than the bundle that
 * starts the render.
 *
 * If a coordinate does drift, the cost is a stand-in that shifts slightly as it
 * crossfades out, not a broken page.
 */

/** The three labels the diagram is built from. Changing any of them changes the
 *  measured widths below — see the re-derivation note above. */
const NODE_A = 'WYSIWYG editor'
const NODE_B = 'native mermaid'
const EDGE_LABEL = 'renders'

/**
 * Every string both renderers show. They live here rather than in the JSX
 * because the served document paints its own copy of this block: a string kept
 * in only one of the two is stale for the first second of a cold load, in the
 * copy that is hardest to notice.
 */
/** The sr-only h1, which is the diagram read as a sentence — composed rather
 *  than restated so the accessible headline cannot drift from the visible one. */
export const HERO_HEADLINE = `${NODE_A} ${EDGE_LABEL} ${NODE_B}`
export const HERO_SUBHEAD = 'Click a node to edit it. Perfect for polishing AI-generated diagrams.'
export const HERO_LICENSE = 'MIT'
export const HERO_HINT_LEAD = 'That headline is a live Mermaid diagram.'
export const HERO_HINT_BODY = 'Double-click a word to rewrite it.'

/**
 * The headline, as Mermaid. The verb rides the connector, which is where mermaid
 * puts verbs, so the whole thing reads as one sentence.
 */
export const HERO_SOURCE_LR = `flowchart LR
  A[${NODE_A}] -->|${EDGE_LABEL}| B[${NODE_B}]`

export const HERO_SOURCE_TD = `flowchart TD
  A[${NODE_A}] -->|${EDGE_LABEL}| B[${NODE_B}]`

/**
 * Inclusive at 760 to match `@media (max-width: 760px)` in site.css, which sizes
 * the band for this layout. A strict `<` disagrees with the media query at
 * exactly 760px: the band goes tall for a stacked diagram while the source is
 * still left-to-right.
 */
export const HERO_STACK_MAX_WIDTH = 760

/**
 * Everything below builds raw HTML strings, where React's escaping does not
 * apply. The JSX consumers of these same constants get escaped for free, so
 * without this the first hero string to contain a `<`, `&` or quote would render
 * correctly in the app and malformed in the served document — the copy nobody
 * looks at during normal development. Static entities written directly into the
 * templates (`&middot;`, `&amp;`) are markup, not values, and stay as authored.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Mermaid's arrowhead. `userSpaceOnUse` keeps it sized in viewBox units rather
 * than scaling with the 2px stroke the site puts on the connector, which is how
 * mermaid draws it.
 */
function marker(id: string): string {
  return `<marker id="${id}" viewBox="0 0 10 10" refX="5" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" class="arrowMarkerPath"/></marker>`
}

/**
 * A label as mermaid emits it: HTML in a foreignObject, not SVG <text>. The
 * class names are load-bearing — site.css styles the real diagram's labels
 * through `.nodeLabel` / `.edgeLabel` and reaches the stand-in's by the same
 * selectors, so the two cannot drift apart on typography or colour.
 */
function label(kind: 'nodeLabel' | 'edgeLabel', x: number, y: number, w: number, text: string): string {
  return `<foreignObject x="${x}" y="${y}" width="${w}" height="24"><div xmlns="http://www.w3.org/1999/xhtml" class="hero-ph-label"><span class="${kind}"><p>${esc(text)}</p></span></div></foreignObject>`
}

function node(x: number, y: number, w: number, h: number, labelX: number, labelW: number, text: string): string {
  return `<g class="node"><rect x="${x}" y="${y}" width="${w}" height="${h}"/>${label('nodeLabel', labelX, y + (h - 24) / 2, labelW, text)}</g>`
}

/**
 * Order is paint order: connector first, then the boxes, then the edge label
 * last so its backing plate covers the line rather than the line striking
 * through the word.
 */
function svg(id: string, viewBox: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="flowchart" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"><defs>${marker(id)}</defs>${body}</svg>`
}

const VIEW_BOX_LR = '0 0 487.890625 70'
const VIEW_BOX_TD = '0 0 203.40625 198'

const HERO_PLACEHOLDER_LR = svg(
  'hero-ph-arrow-lr',
  VIEW_BOX_LR,
  `<path class="flowchart-link" d="M195.406,35L299.547,35" marker-end="url(#hero-ph-arrow-lr)"/>` +
    node(8, 8, 187.40625, 54, 38, 127.40625, NODE_A) +
    node(303.546875, 8, 176.34375, 54, 333.546875, 116.34375, NODE_B) +
    label('edgeLabel', 220.40625, 23, 58.140625, EDGE_LABEL),
)

const HERO_PLACEHOLDER_TD = svg(
  'hero-ph-arrow-td',
  VIEW_BOX_TD,
  `<path class="flowchart-link" d="M101.703,62L101.703,132" marker-end="url(#hero-ph-arrow-td)"/>` +
    node(8, 8, 187.40625, 54, 38, 127.40625, NODE_A) +
    node(13.53125, 136, 176.34375, 54, 43.53125, 116.34375, NODE_B) +
    label('edgeLabel', 72.6328125, 87, 58.140625, EDGE_LABEL),
)

/**
 * Both orientations ship in the served document because the build cannot know
 * the window width; site.css shows one and hides the other at the same
 * breakpoint `HERO_STACK_MAX_WIDTH` encodes. Together they are under 2KB.
 *
 * This media-query pick is the best a static document can do, and it is only
 * ever the pre-mount stand-in. Once React is up it renders `heroPlaceholderFor`
 * instead — see below for why that distinction matters.
 */
const HERO_PLACEHOLDER_BOTH_HTML =
  `<div class="hero-placeholder hero-placeholder-lr">${HERO_PLACEHOLDER_LR}</div>` +
  `<div class="hero-placeholder hero-placeholder-td">${HERO_PLACEHOLDER_TD}</div>`

/**
 * The stand-in for the orientation the live diagram actually chose.
 *
 * The app must not reuse the media-query pair above: the diagram's orientation
 * is decided once at mount from `window.innerWidth` and deliberately never
 * re-picked (a resize would overwrite whatever the visitor typed into the
 * headline), while a media query keeps tracking the window forever. Two
 * predicates over one crossfade means a resize across the breakpoint can leave a
 * stacked stand-in fading into a left-to-right diagram in the same box, which is
 * a jump rather than a settling. Feeding this the same source the editor got
 * collapses it back to one decision.
 */
export function heroPlaceholderFor(source: string): string {
  const svgMarkup = source === HERO_SOURCE_TD ? HERO_PLACEHOLDER_TD : HERO_PLACEHOLDER_LR
  return `<div class="hero-placeholder">${svgMarkup}</div>`
}

/** The stand-in's viewBox for a given hero source, so a dev-only check can
 *  compare it against what mermaid actually rendered. */
export function heroPlaceholderViewBox(source: string): string {
  return source === HERO_SOURCE_TD ? VIEW_BOX_TD : VIEW_BOX_LR
}

/**
 * First-paint content for `#root`, replaced by the app on mount.
 *
 * It reproduces the hero's vertical rhythm exactly — a spacer the height of the
 * sticky header, then the section's own padding, badge, band, hint and
 * subheading at their real margins — so that mount swaps the markup without
 * moving anything the visitor is already looking at. The band carries the same
 * stand-in the React hero does, so the headline never blinks out.
 *
 * The chrome the app owns and this does not (nav, buttons, the sections below)
 * arrives around the hero rather than displacing it.
 *
 * index.html is the single entry for every route, so this landing hero would
 * also paint over /playground and /hero-loop until the bundle routes away from
 * it. The trailing script drops it on those routes, matching main.tsx's own
 * pathname normalization. It is inline and synchronous so it runs during parse,
 * before first paint — it prevents a flash rather than causing one, and the only
 * thing it costs a JavaScript-less visitor is a landing hero on a route that
 * cannot function without JavaScript anyway.
 */
export function heroBootHtml(): string {
  return `<div class="boot">
  <div class="boot-header"></div>
  <div class="hero-section">
    <div class="hero-badge">
      <span class="hero-badge-dot"></span>
      Open source &middot; ${esc(HERO_LICENSE)} &middot; React &amp; vanilla
    </div>
    <h1 class="sr-only">${esc(HERO_HEADLINE)}</h1>
    <div class="hero-masthead" aria-hidden="true">
      <div class="hero-placeholder-layer">${HERO_PLACEHOLDER_BOTH_HTML}</div>
    </div>
    <div class="hero-hint">
      <span class="hero-hint-lead">${esc(HERO_HINT_LEAD)}</span>
      <span>${esc(HERO_HINT_BODY)}</span>
    </div>
    <p class="hero-sub">${esc(HERO_SUBHEAD)}</p>
  </div>
</div>
<script>if(location.pathname.replace(/\\/+$/,'')!==''){var b=document.querySelector('.boot');if(b)b.remove()}</script>`
}
