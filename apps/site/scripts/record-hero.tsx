/**
 * Records `assets/hero-loop.webp` from the REAL playground.
 *
 * Why a recorder exists at all: the hero is the first thing a visitor sees, and it has to show a pointer.
 * Visimer's claim is direct manipulation of the rendered diagram, so a clip with no cursor is
 * indistinguishable from a source-pane screencast — the double-click that renames the node is the product,
 * and an invisible double-click proves nothing. The previous asset was recorded without one, and there was
 * no script to re-record it. This is that script.
 *
 * Everything in frame is the real app: real Mermaid dagre layout, a real double-click, real keystrokes, the
 * editor's own caret, and the app's own source-sync highlight. The ONLY painted element is the pointer,
 * because /playground paints none (/hero-loop does, but it is a different surface with different chrome).
 *
 * Determinism: the playground animates nothing on its own between inputs, so this owns the frame clock
 * rather than sampling wall time. Each frame positions the overlay, fires at most one real input, then
 * screenshots — so frame N is reproducible run to run.
 *
 * PREREQUISITES (deliberately not repo dependencies — this runs about twice a year, and neither belongs in
 * every contributor's install):
 *   1. playwright       pnpm --filter site add -D playwright && pnpm --filter site exec playwright install chromium
 *   2. img2webp         brew install webp        (libwebp; also provides webpmux for inspection)
 *
 * USAGE:
 *   pnpm dev:site                        # serves /playground on :5174
 *   pnpm --filter site exec tsx scripts/record-hero.tsx
 *   # then follow the img2webp line it prints
 */
import { chromium } from 'playwright'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_BASE = process.env.HERO_URL ?? 'http://localhost:5174'
const OUT = join(tmpdir(), 'visimer-hero-frames')

/** The diagram the hero renames a node in. Seeded through the playground's own `#code=` hash. */
const SRC = `flowchart TD
  A[Open a PR] --> B{Tests green?}
  B -->|yes| C[Ship it]
  B -->|no| D[Fix bugs]
  D --> A`
const TARGET_LABEL = 'Ship it'
const NEW_LABEL = 'Deploy'

/**
 * The pointer, copied in from openstylus `openstyles/scene/Cursor.tsx` (declared `kind:"asset"` there, and
 * that DS declares `distribution: "copy-in"`; its `openstyles/` tree is not in the published package, so
 * copy-in is the sanctioned path rather than a dependency).
 *
 * An OS pointer is a faithful reproduction of fixed system chrome, so these two ink values are the
 * reproduced artifact's own bytes — not themeable, not palette. The silhouette is drawn twice, a fattened
 * outline pass beneath a fill pass, so the edge survives WebP/GIF quantization over a busy diagram canvas.
 *
 * HOTSPOTS are in the source's 24-unit box: the arrow's tip is (3,2), the I-beam's centre is (12,12).
 * Position by hotspot, never by the SVG's corner, or the visible tip sits several px off the thing it is
 * meant to be touching and the shot stops being evidence of anything.
 */
const ARROW_SVG = `<svg width="26" height="26" viewBox="0 0 24 24" style="display:block;overflow:visible" aria-hidden="true"><g fill="#ffffff" stroke="#ffffff" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"><path d="M3,2 L3,19.5 L7.6,15.4 L10.5,21.6 L13.3,20.3 L10.4,14.3 L16.3,14.3 Z"></path></g><g fill="#000000"><path d="M3,2 L3,19.5 L7.6,15.4 L10.5,21.6 L13.3,20.3 L10.4,14.3 L16.3,14.3 Z"></path></g></svg>`
const IBEAM_SVG = `<svg width="26" height="26" viewBox="0 0 24 24" style="display:block;overflow:visible" aria-hidden="true"><g fill="#ffffff" stroke="#ffffff" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"><path d="M9,3 h6 v1.6 h-2.2 v14.8 h2.2 v1.6 h-6 v-1.6 h2.2 v-14.8 h-2.2 z"></path></g><g fill="#000000"><path d="M9,3 h6 v1.6 h-2.2 v14.8 h2.2 v1.6 h-6 v-1.6 h2.2 v-14.8 h-2.2 z"></path></g></svg>`

const ease = (t: number): number => 1 - (1 - t) ** 3
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

const encodeCode = (code: string): string => {
  const bytes = new TextEncoder().encode(code)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
// 1200x675 at deviceScaleFactor 2 — a 1200px layout shot at 2x, which is what the published 2400x1350
// asset is. Rendering into a 2400px viewport instead reflows the layout and shrinks everything.
const page = await browser.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 2 })
await page.goto(`${URL_BASE}/playground#code=${encodeCode(SRC)}`, { waitUntil: 'networkidle' })
await page.waitForSelector('g.node', { timeout: 15_000 })
await page.waitForTimeout(1200)

await page.evaluate(
  ({ arrow, ibeam }) => {
    const host = document.createElement('div')
    host.id = '__hero_cursor'
    host.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:2147483647;'
    host.innerHTML = `<div id="__hero_arrow">${arrow}</div><div id="__hero_ibeam" style="display:none">${ibeam}</div>`
    document.body.appendChild(host)
  },
  { arrow: ARROW_SVG, ibeam: IBEAM_SVG },
)

/** Node geometry straight off the rendered Mermaid SVG — never hand-placed. */
const target = await page.evaluate((label) => {
  const n = [...document.querySelectorAll('g.node')].find((g) => (g.textContent ?? '').trim() === label)
  if (!n) return null
  const r = n.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}, TARGET_LABEL)
if (!target) throw new Error(`no node labelled "${TARGET_LABEL}" in the rendered diagram`)

const setCursor = (x: number, y: number, ibeam: boolean) =>
  page.evaluate(
    ({ x, y, ibeam }) => {
      const u = 26 / 24
      const hx = ibeam ? 12 * u : 3 * u
      const hy = ibeam ? 12 * u : 2 * u
      document.getElementById('__hero_cursor')!.style.transform = `translate(${x - hx}px, ${y - hy}px)`
      ;(document.getElementById('__hero_arrow') as HTMLElement).style.display = ibeam ? 'none' : 'block'
      ;(document.getElementById('__hero_ibeam') as HTMLElement).style.display = ibeam ? 'block' : 'none'
    },
    { x, y, ibeam },
  )

const START = { x: 1150, y: 640 }
const AIM = { x: target.x + 22, y: target.y + 2 }
/** Bare canvas, left of the diagram. */
const EMPTY = { x: 580, y: 548 }

const TRAVEL_END = 34
const DBLCLICK = 40
const TYPE_START = 58
const PER_CHAR = 9
const TYPE_END = TYPE_START + NEW_LABEL.length * PER_CHAR
const COMMIT = TYPE_END + 30
const RETREAT_START = COMMIT + 8
const RETREAT_END = COMMIT + 30
const TOTAL = COMMIT + 62

for (let f = 0; f < TOTAL; f++) {
  let cx: number
  let cy: number
  let ibeam: boolean
  if (f < RETREAT_START) {
    const t = ease(Math.min(1, Math.max(0, (f - 4) / (TRAVEL_END - 4))))
    cx = lerp(START.x, AIM.x, t)
    cy = lerp(START.y, AIM.y, t)
    ibeam = f >= TRAVEL_END - 8
  } else {
    const t = ease(Math.min(1, (f - RETREAT_START) / (RETREAT_END - RETREAT_START)))
    cx = lerp(AIM.x, EMPTY.x, t)
    cy = lerp(AIM.y, EMPTY.y, t)
    ibeam = t < 0.25
  }
  await setCursor(cx, cy, ibeam)

  if (f === DBLCLICK) await page.mouse.dblclick(target.x, target.y)
  if (f === TYPE_START - 2) await page.keyboard.press('Meta+A')
  if (f >= TYPE_START && f < TYPE_END && (f - TYPE_START) % PER_CHAR === 0) {
    await page.keyboard.type(NEW_LABEL[(f - TYPE_START) / PER_CHAR]!)
  }
  if (f === COMMIT) await page.keyboard.press('Enter')
  // Committing leaves the node selected, and a selected node keeps the floating node toolbar up, covering
  // the "yes" edge label. Escape does NOT deselect in Visimer — clicking bare canvas is the real gesture,
  // and it also gives the loop a clean resting frame.
  if (f === RETREAT_END) await page.mouse.click(EMPTY.x, EMPTY.y)

  await page.screenshot({ path: join(OUT, `f${String(f).padStart(4, '0')}.png`) })
}

await browser.close()

console.log(`\n${TOTAL} frames -> ${OUT}\n`)
console.log('Encode with:')
console.log(`  img2webp -q 76 -d 33 -loop 0 -lossy ${OUT}/f*.png -o assets/hero-loop.webp\n`)
console.log('Verify with:  webpmux -info assets/hero-loop.webp')
