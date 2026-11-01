// Can this account open this hat? Pure, so the decision is testable without
// Firebase (tests/unit/hatAccess.spec.js); initializeDB supplies the reads.
//
// Three answers, and only the last stops the app:
//   'member'  - the probe read its own member record
//   'created' - the hat did not exist, and this account just made it
//   'denied'  - the hat exists and this account is not in it
//
// 'denied' used to be logged and then ignored: initializeDB went on to
// attach every listener anyway, each one refused, and the person saw an empty
// app with nothing to say why (Sentry, 2026-11-01 - someone signed in on an
// iPhone landed on a hat they were not a member of).
export async function checkHatAccess ({ readOwnMember, createHat, onDenied = () => {} }) {
  try {
    const exists = await readOwnMember();
    if (exists) return 'member';
    await createHat();
    return 'created';
  } catch (readError) {
    // Permission denied: either the hat doesn't exist (create is allowed) or
    // it exists and this account isn't a member (create is refused too, which
    // is itself the answer).
    try {
      await createHat();
      return 'created';
    } catch (createError) {
      onDenied(readError);
      return 'denied';
    }
  }
}

// What to do once a hat has said no. Someone else's hat: go back to your own,
// which can never be in this state for long (a new one is simply created).
// Your OWN hat refusing you has no way back from inside the app, so stay and
// explain - and never switch to the hat that just refused, or it would loop.
export function hatToFallBackTo ({ deniedHat, primaryHat }) {
  if (!primaryHat || deniedHat === primaryHat) return null;
  return primaryHat;
}
