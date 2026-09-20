// Telling him it's finished, when he isn't looking.
//
// Matt, 2026-09-20: "Can we have it notify me when it's done?"
//
// WHAT THIS IS AND ISN'T. This is a local notification from a page that is
// still alive — the tab exists, its JavaScript is running, and it has just
// finished applying a read-through. That covers the case he actually
// described: putting the phone down or flicking to another app for half a
// minute while the model works.
//
// It is NOT web push, and it cannot cover a page iOS has discarded. There is
// nothing running to fire it. What covers THAT case is not a notification at
// all but `pendingJob.js`: the job is collected and applied the next time the
// fridge is opened, so the work is never lost, only deferred to the moment he
// looks. Those two together are what make leaving the app safe.
//
// Permission is asked for at the point it would be used and never on a cold
// screen, because a permission prompt with no context in front of it is the
// one that gets denied forever.

const supported = () => typeof window !== 'undefined' && 'Notification' in window

/**
 * Ask, but only if it is still worth asking. A denied permission is
 * permanent in most browsers, so re-requesting achieves nothing and
 * `requestPermission` resolves instantly with the old answer.
 */
export const requestNotifyPermission = async () => {
  if (!supported()) return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

/**
 * Fire one, if the page is in the background.
 *
 * Deliberately silent when the page is VISIBLE: he is already looking at the
 * report that says the same thing, and a notification for something on screen
 * is noise. Returns whether one was actually shown, which is the only honest
 * thing to tell a caller that might want to say "you'll get a ping".
 */
export const notifyDone = (title, body, { doc = document } = {}) => {
  if (!supported() || Notification.permission !== 'granted') return false
  if (doc.visibilityState === 'visible') return false
  try {
    const note = new Notification(title, {
      body,
      // One tag, so a second read-through replaces the first rather than
      // stacking. The punchlist lesson in reverse: there, per-day tags were
      // needed because each day's nudge was a different thing to see; here
      // there is only ever one latest answer.
      tag: 'mealhat-fridge',
      icon: '/img/icons/android-chrome-192x192.png'
    })
    note.onclick = () => {
      window.focus()
      note.close()
    }
    return true
  } catch {
    // Some browsers throw for a constructed Notification outside a service
    // worker. Nothing depends on this succeeding.
    return false
  }
}
