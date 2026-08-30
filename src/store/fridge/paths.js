// Where a fridge lives, and how a food's name becomes a key.
//
// Kept free of Firebase imports so it can be unit-tested directly — the store
// module beside it cannot be, since importing that pulls in the SDK.

// All of a fridge's data lives under `fridge/<key>`, top level, because the
// path IS the credential (see utils/fridge/fridgeKey.js). Nesting it under the
// hat would put the secret behind a guessable key — hat names are emails with
// the punctuation swapped — and RTDB rules have nowhere to receive a
// credential as a parameter.
export const fridgeRoot = (key) => `fridge/${key}`
export const timersPath = (key) => `${fridgeRoot(key)}/timers`
export const templatesPath = (key) => `${fridgeRoot(key)}/templates`
export const historyPath = (key) => `${fridgeRoot(key)}/history`

// The pointer that lets a SIGNED-IN phone find its own fridge without being
// handed the secret in a URL. Readable only by the hat's members, so the
// capability key never leaves the people who already have access.
export const fridgeKeyPointer = (hat) => `${hat}/fridgeKey`

// A template is stored UNDER its own title, and Firebase forbids . $ # [ ] /
// in a key. "Dr. Pepper" and "1/2 gallon milk" are ordinary things to buy, and
// both used to make the write throw — inside a try/catch that only logged, so
// the food simply never got learned and nobody found out. The title itself
// still rides along in the record; this is only the shelf it sits on.
export const templateKey = (title) => String(title || '').replace(/[.$#[\]/]/g, '_').trim()
