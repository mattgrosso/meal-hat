import { getDatabase, ref as dbRef, push, set, serverTimestamp } from 'firebase/database';

// In-app bug reporting, ported from Cinema Roll's `src/utils/bugReports.js`.
//
// Reports go to a top-level `bugReports/` node, OUTSIDE any hat. The security
// rule makes it write-only: anyone signed in can file, nobody can read back,
// because a report carries the reporter's email and their app state. Triage
// goes through `yarn fetch-bug-reports`, which reads with credentials that
// bypass rules.

/**
 * What was true when the report was filed.
 *
 * Chosen from what actually went wrong in this app rather than copied: the
 * hat you were in, how much was loaded, and the shape of the shopping list.
 * Cinema Roll had to add fields later after a report it could not diagnose,
 * so this errs toward "would this have explained the bug?".
 */
function buildAppStateSummary (store, route) {
  const state = store.state;
  const shopping = Object.values(state.shoppingList || {});

  return {
    route: route?.fullPath || window.location.hash,
    version: process.env.VUE_APP_VERSION || null,

    // Which hat, and whether it is their own or one they joined — a bug that
    // only happens in a shared hat is a very different bug.
    hat: state.databaseTopKey,
    isPrimaryHat: state.databaseTopKey === store.getters.primaryDatabaseTopKey,
    hatCount: (state.mealHatsList || []).length,

    mealCount: (state.meals || []).length,

    // Both numbers matter. `loaded` is bounded by the 400-day window, so
    // "upcoming is 0 but loaded is 247" means something very different from
    // "both are 0", which would suggest the read itself failed.
    drawnUpcoming: (state.drawnMeals || []).length,
    drawnLoaded: (state.drawnMealsWithHistory || []).length,

    // Split by source: regeneration rebuilds meal items and leaves manual ones
    // alone, so the ratio is the first thing worth seeing on any shopping-list
    // complaint.
    shoppingTotal: shopping.length,
    shoppingFromMeals: shopping.filter((item) => item && item.source === 'meal').length,
    shoppingManual: shopping.filter((item) => item && item.source !== 'meal').length,
    shoppingPurchased: shopping.filter((item) => item && item.purchased).length,

    catalogSize: Object.keys(state.groceryCatalog || {}).length,
    online: navigator.onLine
  };
}

function buildReport (store, text, route) {
  return {
    createdAt: serverTimestamp(),
    transcript: text,
    reporterEmail: store.state.userEmail || null,
    url: window.location.href,
    userAgent: navigator.userAgent,
    screenSize: `${window.innerWidth}x${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio || 1,
    // Stringified, not a nested object: RTDB silently drops keys whose value is
    // an empty object, so a plain object here can lose fields with no warning.
    appState: JSON.stringify(buildAppStateSummary(store, route))
  };
}

// Offline stash.
//
// This matters more here than it did in Cinema Roll: Meal Hat is a PWA used in
// a grocery store, which is exactly where signal dies and where you notice
// something worth reporting. `bugReports/` sits outside the account root, so it
// cannot use any hat-scoped write path — it needs its own queue.
//
// serverTimestamp() placeholders serialize as plain objects, so a stashed
// report is re-stamped on the eventual write rather than trusting the clock of
// a device that was offline.
const STASH_KEY = 'mealhat-pending-bug-reports';
const STASH_LIMIT = 10;

function readStash () {
  try {
    const parsed = JSON.parse(localStorage.getItem(STASH_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStash (reports) {
  try {
    localStorage.setItem(STASH_KEY, JSON.stringify(reports.slice(-STASH_LIMIT)));
  } catch {
    // Storage full or blocked. Nothing more to do for a best-effort stash.
  }
}

/** Send anything stashed earlier. Returns how many went out. */
export async function flushStashedBugReports () {
  const stash = readStash();
  if (!stash.length || !navigator.onLine) return 0;

  const db = getDatabase();
  let sent = 0;

  for (const report of stash) {
    try {
      await set(push(dbRef(db, 'bugReports')), { ...report, createdAt: serverTimestamp() });
      sent += 1;
    } catch {
      // Still unreachable — keep the rest for next time rather than dropping
      // them, and stop trying now.
      break;
    }
  }

  writeStash(stash.slice(sent));
  return sent;
}

/**
 * File a report.
 *
 * Resolves `{ queued: true }` when it went to the stash instead of the network,
 * so the UI can say "saved, will send later" rather than a misleading "sent".
 * Throws only when online and the write genuinely failed.
 */
export async function submitBugReport (store, transcript, route) {
  const text = (transcript || '').trim();
  if (!text) throw new Error('Describe what happened before sending.');

  const report = buildReport(store, text, route);

  try {
    const db = getDatabase();
    await set(push(dbRef(db, 'bugReports')), report);
    // A successful write is also the best moment to drain the stash.
    flushStashedBugReports().catch(() => {});
  } catch (error) {
    writeStash([
      ...readStash(),
      // clientCreatedAt so triage can still tell when it actually happened,
      // even though createdAt gets re-stamped server-side on the real write.
      { ...report, createdAt: null, clientCreatedAt: Date.now(), queuedOffline: true }
    ]);

    if (!navigator.onLine) return { queued: true };
    throw error;
  }

  return { queued: false };
}
