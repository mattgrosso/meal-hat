// Keeping a few minutes of dictation from evaporating.
//
// The whole point of this flow is that Matt stands in the kitchen for several
// minutes talking into a text box. iOS discards a backgrounded web view's page
// without warning, and a phone in a kitchen gets a call, a notification, or a
// hand that needs to hold something. Losing that text means doing the whole
// walk again, which is the one thing that would stop him ever using this.
//
// So every keystroke is written to localStorage, and a draft is offered back
// when the screen opens.
//
// Storage may THROW rather than fail quietly — Safari in private mode does
// exactly that on write — so every access here is wrapped. A draft that cannot
// be saved must never take the typing down with it.

const KEY = 'mealhat.fridge.talkDraft'

// Old enough to be from a different trip to the kitchen. Offering to restore
// last week's inventory would be worse than offering nothing.
export const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000

export const saveDraft = (text, { storage = window.localStorage, now = Date.now } = {}) => {
  try {
    if (!String(text || '').trim()) {
      storage.removeItem(KEY)
      return
    }
    storage.setItem(KEY, JSON.stringify({ text, at: now() }))
  } catch {
    // No storage, or a full quota. The text is still in the textarea; this is
    // insurance, not the record.
  }
}

export const readDraft = ({ storage = window.localStorage, now = Date.now } = {}) => {
  try {
    const raw = storage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.text || !String(parsed.text).trim()) return null
    if (!Number.isFinite(parsed.at) || now() - parsed.at > DRAFT_MAX_AGE_MS) return null
    return { text: String(parsed.text), at: parsed.at }
  } catch {
    // Corrupt or unreadable. Nothing to restore is a fine answer.
    return null
  }
}

export const clearDraft = ({ storage = window.localStorage } = {}) => {
  try {
    storage.removeItem(KEY)
  } catch {
    // Nothing to do about it, and nothing depends on it.
  }
}
