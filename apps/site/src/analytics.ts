import posthog from 'posthog-js'

/**
 * PostHog wiring for the marketing site only — never import this from the
 * published packages or the playground apps.
 *
 * No key (local dev, forks) -> everything no-ops. The default api_host is a
 * same-origin path that vercel.json proxies to PostHog so ad blockers, which
 * a developer audience runs at high rates, don't eat the events. On `pnpm dev`
 * there is no proxy, so captures 404 harmlessly and dev traffic stays out of
 * the project.
 */
const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined

if (key) {
  posthog.init(key, {
    api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? '/ingest',
    ui_host: 'https://us.posthog.com',
    defaults: '2025-05-24',
    // cookieless: no banner needed; we trade cross-visit identity away
    persistence: 'memory',
  })
}

export function track(event: string, properties?: Record<string, unknown>) {
  if (!key) return
  posthog.capture(event, properties)
}
