// Crash reporting, production only. Wired 2026-10-07 as part of Bug Desk's
// Sentry rollout: every new error here becomes a Bug Desk card with a fix
// plan on Matt's phone, and closing the card resolves it in Sentry.
//
// Errors only. No performance tracing (tracesSampleRate 0): the free plan's
// error quota is shared by every app, and a crash is what Bug Desk can act
// on. Every URL is scrubbed before it leaves — Firebase takes the sign-in
// token as `?auth=` and other APIs their keys in the query string, and
// Sentry would keep them for 90 days (Cinema Roll's 2026-10-06 lesson,
// utils/scrubUrl.js).
import * as Sentry from '@sentry/vue';
import { scrubBreadcrumb, scrubEvent } from './utils/scrubUrl';

const DSN = 'https://56557ae2c2dc79cd37050dc83719819b@o4504483013525504.ingest.us.sentry.io/4512218251198464';

export function setupSentry (app) {
  if (!import.meta.env.PROD) return;
  // VUE_APP_VERSION is defined at build time (vite.config.mjs), the same
  // number the build stamp shows, so an error names the deploy it came from.
  const version = process.env.VUE_APP_VERSION;
  Sentry.init({
    app,
    dsn: DSN,
    release: version ? `meal-hat@${version}` : undefined,
    environment: 'production',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    sampleRate: 1.0,
    maxValueLength: 8000,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
}
