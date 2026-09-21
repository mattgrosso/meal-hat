import { ref as dbRef, get, update } from 'firebase/database';
import { db, auth, authReady } from '@/firebase';

// The reply half of the bug button (2026-09-21, ported from Cinema Roll):
// `yarn resolve-bug-report <id> --understood ... --fixed ...` writes a
// plain-language notice under the reporter's email key at
// bugReportResolutions, and BugResolutionNotice.vue shows it once on their
// next launch. Reports carry the reporter's EMAIL (not uid), so the notice is
// keyed the same way, and the rules compare the key against auth.token.email
// transformed identically. Only the reporter can read their own; the only
// client write is flipping `seen`.

const NODE = 'bugReportResolutions';
const APP = 'meal-hat';

/** `Someone@Example.com` -> `someone@example-com`, matching the rules. */
export function emailToMemberKey (email) {
  if (typeof email !== 'string' || !email) return null;
  return ['.', '$', '#', '[', ']', '/'].reduce(
    (key, character) => key.split(character).join('-'),
    email.trim().toLowerCase()
  );
}

/** This app's unseen notices, oldest first. */
export function unseenResolutions (entries, app = APP) {
  return Object.entries(entries || {})
    .filter(([, value]) => value && !value.seen && (!value.app || value.app === app))
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => (a.resolvedAt || 0) - (b.resolvedAt || 0));
}

const currentKey = async () => {
  await authReady;
  return emailToMemberKey(auth.currentUser?.email);
};

export async function fetchUnseenResolutions () {
  try {
    const key = await currentKey();
    if (!key) return [];
    return unseenResolutions((await get(dbRef(db, `${NODE}/${key}`))).val());
  } catch {
    // Offline or refused - the notice simply waits for another launch.
    return [];
  }
}

export async function markResolutionsSeen (ids) {
  if (!ids?.length) return;
  try {
    const key = await currentKey();
    if (!key) return;
    const updates = {};
    ids.forEach((id) => { updates[`${NODE}/${key}/${id}/seen`] = true; });
    await update(dbRef(db), updates);
  } catch {
    // Marked on a later dismissal instead.
  }
}
