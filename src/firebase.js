// The one Firebase app, and the handles onto it.
//
// This used to live at the top of src/store/index.js. It moved out when the
// fridge got its own store module (2026-08-29): two stores both needing `db`
// meant either a circular import (fridge -> store/index -> fridge) or two
// initializeApp calls, which would give the app two independent auth sessions
// and two token refreshes racing each other.
//
// Nothing here is new. The comments below are the reasons the original
// ordering was chosen, and they still hold.

import { initializeApp } from "firebase/app";
import { getDatabase, connectDatabaseEmulator } from "firebase/database";
import { getAuth, onAuthStateChanged, connectAuthEmulator } from "firebase/auth";

export const firebaseConfig = {
  apiKey: process.env.VUE_APP_GOOGLE_API_KEY,
  authDomain: "meal-hat.firebaseapp.com",
  projectId: "meal-hat",
  storageBucket: "meal-hat.appspot.com",
  messagingSenderId: "871807065045",
  appId: "1:871807065045:web:eaaf302a198f18c41a3b5c",
  databaseURL: "https://meal-hat-default-rtdb.firebaseio.com",
}

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// The Playwright suite runs against the Firebase EMULATORS, not production.
//
// Two reasons, both discovered the hard way (2026-08-27). The E2E tests used
// to fake a session with two localStorage keys; when initializeDB started
// requiring a real Firebase user (the membership lockdown), every test landed
// on the Login screen — and a Google popup is not something an automated
// browser can complete. And worse: for as long as the tests DID work, they
// were writing meals into the production database.
//
// The flag is compile-time (vue-cli inlines process.env.VUE_APP_*), so a
// production build contains `if (false)` and no emulator code path exists to
// trigger by accident. playwright.config.js sets it on the dev server it
// starts; nothing else does.
export const useEmulators = process.env.VUE_APP_FIREBASE_EMULATORS === '1';
if (useEmulators) {
  connectDatabaseEmulator(db, 'localhost', 9000);
}

// Auth has to be initialized HERE, at boot, not only inside the login action.
//
// Sign-in state is restored from localStorage by the router's loggedIn(), which
// is enough to decide what to render but tells Firebase nothing. Until getAuth()
// runs, the Auth SDK never rehydrates its persisted session, so the database
// client sends its requests with no token at all. That was invisible while the
// rules were open. Under rules that require `auth != null` it would mean every
// returning user silently reads nothing: past the route guard, into an app with
// no meals and no explanation.
const auth = getAuth(app);
if (useEmulators) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
}

// Resolves with the restored user (or null) the first time Firebase reports auth
// state. Restoration is asynchronous, so anything that touches the database has
// to wait for this or it races the token.
let markAuthReady;
const authReady = new Promise((resolve) => { markAuthReady = resolve; });

onAuthStateChanged(auth, (user) => markAuthReady(user));

export { app, db, auth, authReady };
