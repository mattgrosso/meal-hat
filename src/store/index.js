import { createStore } from 'vuex';
import { onValue, ref, set, get, update, query, orderByChild, startAt } from "firebase/database";
import { GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { db, auth, authReady, firebaseConfig } from '@/firebase';
import { v4 as uuidv4 } from 'uuid';
import router from '@/router';
import { analyzeDuplicates, findSimilar, aggregateMealIngredients, remapMealIngredients } from './ingredients';
import { withDrawnDate, compareByDate, isUpcoming, toISODate, isoDaysAgo } from './schedule';
import { withPreservedPurchases } from './purchases';
import { buildMirrorFeed } from '../assets/javascript/mirrorFeed';
import fridge from './fridge';

// How far back drawnMeals is loaded.
//
// The schedule shows the last 7 days and the calendar only needs enough history
// to mark days that already have a meal, so this is generous rather than
// necessary. What matters is that it is BOUNDED: the node was previously
// subscribed whole, so every page load pulled every meal ever drawn and the cost
// grew with the calendar rather than with the hat.
const DRAWN_MEALS_WINDOW_DAYS = 400;

// Bumped when the shape of stored data changes in a way the client must repair.
// Kept per-hat, since hats are shared and migrate independently.
const DRAWN_MEALS_SCHEMA = 'iso';

const removeNaNAndUndefined = (obj) => {
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      if (typeof obj[key] === "object" && obj[key] !== null) {
        removeNaNAndUndefined(obj[key]);
      } else if (Number.isNaN(obj[key]) || obj[key] === undefined) {
        console.error(`NaN or undefined value found in ${key}. The Object was ${JSON.stringify(obj)}`);
        delete obj[key];
      }
    }
  }
  return obj;
};

export default createStore({
  state: {
    userEmail: null,
    databaseTopKey: null,
    mostRecentDatabase: null,
    showTutorial: null,
    meals: null,
    drawnMealsWithHistory: null,
    drawnMeals: null,

    // UNIFIED DATA MODEL
    groceryCatalog: {}, // Single source for all grocery items: id → { id, name, defaultUnits, defaultAisle, defaultLocation }
    shoppingList: {}, // Unified shopping list: id → { groceryId, quantity, units, aisle, location, source, mealId?, purchased }

    // Hats this user belongs to — backs the MealHats sharing screen.
    mealHatsList: null,

    // Secret path segment for this hat's Magic Mirror feed, or null if the
    // feed has never been turned on. Per-hat, so clearState drops it.
    mirrorFeedKey: null,

    // Which hat mirrorFeedKey is subscribed to, so initializeDB can tell
    // "not subscribed" from "subscribed, and the answer is null".
    //
    // The other subscriptions here guard on their own data being empty, which
    // works because their first snapshot always fills it in. This one's normal
    // answer IS null — most hats have no feed — so the same shape would attach
    // a fresh listener on every initializeDB, and the router dispatches that on
    // every guarded navigation.
    mirrorFeedSubscribedFor: null,

    // This hat's fridge key, or null if the hat has no fridge. Per-hat, so
    // clearState drops it, and paired with its own subscribed-for marker for
    // the same reason mirrorFeedKey has one: null is the normal answer.
    fridgeKeyForHat: null,
    fridgeKeySubscribedFor: null,

    // A newer build is live. Set by App.vue's bundle comparison (the primary
    // signal) and by registerServiceWorker's updated() hook (the secondary
    // one); App.vue watches it and applies the update at a safe moment.
    updateAvailable: false
  },
  getters: {
    getMeal: (state) => (id) => {
      return state.meals.find((meal) => meal.id === id);
    },
    databaseTopKey (state) {
      return state.databaseTopKey;
    },
    primaryDatabaseTopKey (state) {
      if (!state.userEmail) {
        return;
      }

      return state.userEmail.replaceAll(/[-!$%@^&*()_+|~=`{}[\]:";'<>?,./]/g, "-");
    },
    // UNIFIED SHOPPING LIST GETTERS
    shoppingListItems: (state) => {
      return Object.values(state.shoppingList || {})
        .map(item => {
          let groceryItem = state.groceryCatalog[item.groceryId];

          // If the catalog has no entry, synthesize one from the item's own fields.
          if (!groceryItem) {
            groceryItem = {
              id: item.groceryId || item.id,
              name: item.name || 'Unknown Item',
              defaultUnits: item.units || '',
              defaultAisle: item.aisle || 0
            };
          }

          return {
            ...item,
            groceryItem: groceryItem
          };
        })
        .sort((a, b) => (a.aisle || 999) - (b.aisle || 999));
    },
    unpurchasedShoppingItems: (state, getters) => {
      return getters.shoppingListItems.filter(item => !item.purchased);
    },
    // The URL to paste into the Magic Mirror. Empty until the current hat has
    // a feed key, which is what the MealHats panel keys its two states on.
    mirrorFeedUrl (state) {
      if (!state.databaseTopKey || !state.mirrorFeedKey) return '';

      return `${firebaseConfig.databaseURL}/mirrorFeed/${state.databaseTopKey}/${state.mirrorFeedKey}.json`;
    },
  },
  mutations: {
    setUserEmail (state, value) {
      state.userEmail = value;
    },
    setDatabaseTopKey (state, parsedEmail) {
      state.databaseTopKey = parsedEmail;
    },
    setMostRecentDatabase (state, value) {
      state.mostRecentDatabase = value;
    },
    setUpdateAvailable (state, value) {
      state.updateAvailable = value;
    },
    setShowTutorial (state, value) {
      state.showTutorial = value;
    },
    setMeals (state, meals) {
      state.meals = meals;
    },
    setDrawnMealsWithHistory (state, drawnMealsWithHistory) {
      state.drawnMealsWithHistory = drawnMealsWithHistory;
    },
    setDrawnMeals (state, drawnMeals) {
      state.drawnMeals = drawnMeals;
    },
    // NEW UNIFIED DATA MUTATIONS
    setGroceryCatalog (state, groceryCatalog) {
      state.groceryCatalog = groceryCatalog || {};
    },
    setShoppingList (state, shoppingList) {
      state.shoppingList = shoppingList || {};
    },
    addToGroceryCatalog (state, groceryItem) {
      if (groceryItem && groceryItem.id) {
        state.groceryCatalog[groceryItem.id] = groceryItem;
      }
    },
    addToShoppingList (state, shoppingItem) {
      if (shoppingItem && shoppingItem.id) {
        state.shoppingList[shoppingItem.id] = shoppingItem;
      }
    },
    removeFromShoppingList (state, itemId) {
      delete state.shoppingList[itemId];
    },
    setMealHatsList (state, mealHatsList) {
      state.mealHatsList = mealHatsList;
    },
    setMirrorFeedKey (state, mirrorFeedKey) {
      state.mirrorFeedKey = mirrorFeedKey || null;
    },
    setMirrorFeedSubscribedFor (state, hat) {
      state.mirrorFeedSubscribedFor = hat || null;
    },
    setFridgeKeyForHat (state, key) {
      state.fridgeKeyForHat = key || null;
    },
    setFridgeKeySubscribedFor (state, hat) {
      state.fridgeKeySubscribedFor = hat || null;
    },
    clearState (state) {
      state.meals = null;
      state.drawnMealsWithHistory = null;
      state.drawnMeals = null;
      state.groceryCatalog = {};
      state.shoppingList = {};
      state.mealHatsList = null;
      state.mirrorFeedKey = null;
      state.mirrorFeedSubscribedFor = null;
      state.fridgeKeyForHat = null;
      state.fridgeKeySubscribedFor = null;
    }
  },
  actions: {
    // Read-only: report grocery entries that share a normalized name (likely the
    // same ingredient split across multiple ids), with how heavily each is
    // referenced, so duplicates can be reviewed before any merge. Writes nothing.
    analyzeIngredientDuplicates (context) {
      return analyzeDuplicates({
        catalog: context.state.groceryCatalog,
        meals: context.state.meals,
        shoppingList: context.state.shoppingList
      });
    },

    // Read-only: find catalog entries that are LIKELY the same ingredient but
    // named differently — close spellings (typos: "mozarella" vs "mozzarella")
    // and "one name contains the other" sharing a meaningful word ("mozzarella"
    // vs "mozzarella cheese"). Generic-word-only overlaps (e.g. plain "cheese")
    // are filtered out. These are HEURISTIC candidates for human review, not
    // automatic merges. Writes nothing.
    findSimilarGroceries (context) {
      return findSimilar(context.state.groceryCatalog);
    },

    // Apply approved merges. `mapping` is { oldId: canonicalId }. Repoints meal
    // ingredient references and shopping-list items from each old id to its
    // canonical id, then deletes the orphaned catalog (and legacy) entries — all
    // with surgical, key-scoped writes. Never auto-decides what to merge.
    async mergeDuplicateGroceries (context, { mapping }) {
      const remap = (id) => (mapping && mapping[id]) || id;
      const oldIds = Object.keys(mapping || {}).filter((id) => remap(id) !== id);
      if (!oldIds.length) {
        return { mealsChanged: 0, shoppingItemsChanged: 0, entriesRemoved: 0 };
      }

      // 1) Meals: repoint references, merging any that now collapse onto one id.
      let mealsChanged = 0;
      for (const meal of (context.state.meals || [])) {
        if (!meal.ingredients || !meal.ingredients.length) continue;
        const { ingredients, touched } = remapMealIngredients(meal.ingredients, remap);
        if (touched) {
          await context.dispatch('updateDBValue', { path: `meals/${meal.id}`, value: { ...meal, ingredients } });
          mealsChanged++;
        }
      }

      // 2) Shopping list: repoint groceryId on any referencing items.
      const shoppingUpdates = {};
      Object.values(context.state.shoppingList || {}).forEach((item) => {
        if (item.groceryId && remap(item.groceryId) !== item.groceryId) {
          shoppingUpdates[item.id] = { ...item, groceryId: remap(item.groceryId) };
        }
      });
      const shoppingItemsChanged = Object.keys(shoppingUpdates).length;
      if (shoppingItemsChanged) {
        await context.dispatch('mergeDBValue', { path: 'shopping-list', value: shoppingUpdates });
      }

      // 3) Delete the orphaned catalog entries.
      const catalogDeletes = {};
      oldIds.forEach((id) => { catalogDeletes[id] = null; });
      await context.dispatch('mergeDBValue', { path: 'grocery-catalog', value: catalogDeletes });

      return { mealsChanged, shoppingItemsChanged, entriesRemoved: oldIds.length };
    },

    // Generate shopping list items from drawn meals
    async generateShoppingListFromMeals (context) {
      console.log('Generating shopping list from drawn meals...');

      if (!context.state.meals) {
        console.log('No meals data available');
        return;
      }

      // Re-read the authoritative drawn meals AND shopping list from the database
      // before touching anything.
      //
      // Drawn meals: the caller (e.g. drawMeals) writes the new draws to the
      // database and the listener only updates local state after a round-trip, so
      // this device's drawnMeals can be stale at this instant. Reading them back
      // here means a meal drawn moments ago is reflected in the shopping list now,
      // not just on the next regeneration.
      //
      // Shopping list: regenerating rewrites the meal-sourced items, and we must
      // base that on what's actually stored — not on possibly-stale memory — so we
      // never wipe items added on another device or by someone else sharing this
      // hat. If we can't confirm either, we fall back / abort rather than risk
      // generating from stale data or overwriting good data.
      let drawnMealsToUse = context.state.drawnMealsWithHistory || context.state.drawnMeals;
      if (context.state.databaseTopKey) {
        try {
          const drawnSnapshot = await get(ref(db, `${context.state.databaseTopKey}/drawnMeals`));
          const drawnData = drawnSnapshot.val();
          if (drawnData && typeof drawnData === 'object') {
            drawnMealsToUse = Object.keys(drawnData).map(key => drawnData[key]);
          }
        } catch (error) {
          console.error('Could not refresh drawn meals before regenerating; using local state:', error);
        }

        try {
          const snapshot = await get(ref(db, `${context.state.databaseTopKey}/shopping-list`));
          context.commit('setShoppingList', snapshot.val() || {});
        } catch (error) {
          console.error('Could not refresh shopping list before regenerating; aborting to avoid data loss:', error);
          return;
        }
      }

      if (!drawnMealsToUse) {
        console.log('No drawn meals data available');
        return;
      }

      // Collect (and sum) the ingredients of upcoming drawn meals, keyed by grocery id.
      const mealIngredients = aggregateMealIngredients({
        drawnMeals: drawnMealsToUse,
        getMeal: (id) => context.getters.getMeal(id),
        catalog: context.state.groceryCatalog
      });

      // Build surgical, key-scoped updates instead of overwriting the whole list.
      // Each entry here targets one item by key; sibling items (including manual
      // ones and anything added elsewhere) are left untouched.
      const shoppingListUpdates = {};
      const catalogUpdates = {};

      // Queue removal of the previously-generated meal items only. Manual items
      // (source !== 'meal') are never queued, so they survive the regeneration.
      Object.values(context.state.shoppingList || {}).forEach(item => {
        if (item && item.source === 'meal') {
          shoppingListUpdates[item.id] = null; // null tells Firebase update() to delete this key
        }
      });

      // Build the freshly-generated meal items, then carry "already bought"
      // across before queueing them. Regeneration deletes every meal row and
      // re-derives it with a new uuid, so a purchase marked on the old row does
      // not survive on its own — see purchases.js.
      const regeneratedRows = [];

      Object.values(mealIngredients).forEach(item => {
        // Ensure a grocery catalog entry exists for this item.
        if (!context.state.groceryCatalog[item.id]) {
          catalogUpdates[item.id] = {
            id: item.id,
            name: item.name,
            defaultUnits: item.units || item.defaultUnits || '',
            defaultAisle: item.aisle || item.defaultAisle || 0,
            defaultLocation: item.location || item.defaultLocation || null
          };
        }

        const catalogEntry = catalogUpdates[item.id] || context.state.groceryCatalog[item.id];
        const shoppingItemId = uuidv4();

        regeneratedRows.push({
          id: shoppingItemId,
          groceryId: item.id,
          quantity: item.quantity,
          units: item.units || item.defaultUnits || '',
          aisle: item.aisle || item.defaultAisle || 0,
          location: item.location || (catalogEntry && catalogEntry.defaultLocation) || null,
          source: 'meal',
          mealId: item.mealId,
          purchased: false
        });
      });

      // Read from the list as it stands BEFORE this rebuild — it was refreshed
      // from the database at the top of this action, so it is authoritative and
      // includes anything ticked off on another device.
      withPreservedPurchases(regeneratedRows, Object.values(context.state.shoppingList || {}))
        .forEach((row) => { shoppingListUpdates[row.id] = row; });

      // Apply the same changes to local state so the UI updates immediately.
      Object.entries(shoppingListUpdates).forEach(([id, value]) => {
        if (value === null) {
          context.commit('removeFromShoppingList', id);
        } else {
          context.commit('addToShoppingList', value);
        }
      });
      Object.values(catalogUpdates).forEach(entry => context.commit('addToGroceryCatalog', entry));

      // Persist surgically. update() merges the given keys into each node and
      // leaves every other key alone — so no full-collection overwrite, and no
      // clobbering of items this device never knew about.
      const writes = [];
      if (Object.keys(shoppingListUpdates).length) {
        writes.push(context.dispatch('mergeDBValue', { path: 'shopping-list', value: shoppingListUpdates }));
      }
      if (Object.keys(catalogUpdates).length) {
        writes.push(context.dispatch('mergeDBValue', { path: 'grocery-catalog', value: catalogUpdates }));
      }
      await Promise.all(writes);

      console.log('Regenerated', Object.keys(mealIngredients).length, 'meal ingredients for shopping list');
    },

    async login (context) {
      // Uses the module-level auth instance created at boot — a second
      // getAuth() here returns the same one, but shadowing it made it look as
      // though auth only existed during login, which is how the session-restore
      // gap went unnoticed.
      const provider = new GoogleAuthProvider();
      // provider.addScope('https://www.googleapis.com/auth/calendar');

      try {
        const result = await signInWithPopup(auth, provider);
        // const token = result.user.stsTokenManager.accessToken; // This is the Google API access token.
        // const user = result.user; // The signed-in user info.

        // Handle the result.
        if (result) {
          const userData = result.user;

          context.commit('setUserEmail', userData.email);

          if (context.state.userEmail) {
            context.dispatch('updateDatabaseTopKey', context.state.userEmail);
            window.localStorage.setItem('mealHatDatabaseTopKey', context.state.databaseTopKey);
            window.localStorage.setItem('mealHatUserEmail', context.state.userEmail);
            context.dispatch('initializeDB');
            router.push('/');
          } else {
            console.error("Login attempted but the user data didn't work");
          }
        }
      } catch (error) {
        console.error(error);
      }
    },
    logout (context) {
      context.commit('setUserEmail', null);
      context.commit('setDatabaseTopKey', null);
      context.commit('setMostRecentDatabase', null);
      context.commit('setShowTutorial', null);
      context.commit('setMeals', null);
      context.commit('setDrawnMealsWithHistory', null);
      context.commit('setDrawnMeals', null);

      context.commit('setGroceryCatalog', {});
      context.commit('setShoppingList', {});
      context.commit('setMealHatsList', null);

      window.localStorage.removeItem('mealHatDatabaseTopKey');
      window.localStorage.removeItem('mealHatUserEmail');

      // Actually end the Firebase session too. Clearing local state alone left
      // the browser holding a live token that still satisfied the database
      // rules — logged out of the app, still authenticated to the data.
      signOut(auth).catch((error) => console.error('Could not sign out:', error));
    },
    updateDatabaseTopKey (context, email) {
      const parsedEmail = email.replaceAll(/[-!$%@^&*()_+|~=`{}[\]:";'<>?,./]/g, "-");

      if (context.state.databaseTopKey !== parsedEmail) {
        context.commit('setDatabaseTopKey', parsedEmail);
        window.localStorage.setItem('mealHatDatabaseTopKey', context.state.databaseTopKey);
        context.dispatch('initializeDB');
      }
    },
    switchDatabase (context, newDatabaseTopKey) {
      // Dispatch the updateDatabaseTopKey action with the new key.
      context.dispatch('updateDatabaseTopKey', newDatabaseTopKey);

      // Clear the existing state.
      context.commit('clearState');

      // Re-initialize the database with the new key.
      context.dispatch('initializeDB');

      // Update the most-recent-database value in the database.
      const mostRecentDatabase = {
        path: `most-recent-database`,
        value: context.state.databaseTopKey
      }
      context.dispatch('updateUserDBValue', mostRecentDatabase);
    },
    async initializeDB (context) {
      // If there's no databaseTopKey in the state, exit the action.
      if (!context.state.databaseTopKey || !context.state.userEmail) {
        return;
      }

      // Wait for Firebase to finish restoring the session before reading
      // anything. The route guard let us this far on the strength of
      // localStorage; the database rules want a token.
      //
      // Wait on the promise, but READ THE LIVE VALUE. On a first-ever visit
      // authReady resolves with null, and login() dispatches this action right
      // after the popup succeeds — trusting the resolved value would sign the
      // user out at the very moment they signed in.
      await authReady;
      const authUser = auth.currentUser;

      // localStorage says signed in, Firebase disagrees — the session really has
      // lapsed. Say so and send them to log in again, rather than leaving an
      // app that looks logged in and quietly reads nothing.
      if (!authUser) {
        console.warn('Stored session has no Firebase user; signing out.');
        context.dispatch('logout');
        router.push('/login');
        return;
      }

      // Make sure the hat exists, creating it if this user is its first.
      //
      // The SHAPE of this matters, and the first version got it wrong in a way
      // that locked out every genuinely new user. It read the hat and created
      // it only when the read came back empty - but under the membership
      // rules, reading a hat you are not a member of is DENIED, and a hat
      // that does not exist yet has no members. So for a brand-new user the
      // read threw, the catch logged it, and the create was never reached:
      // a permanently empty app. Nobody noticed for a week because every
      // existing hat was backfilled with members before the rules shipped -
      // only a NEW account walks this path, and the first one to do so was
      // the E2E suite's tester (2026-08-27).
      //
      // The write rule is the honest probe here, exactly as the rules file
      // says: creation is allowed when the hat does not exist, and refused
      // when it exists and you are not a member - which is the case where the
      // user needs an invite link rather than a create.
      //
      // members + joinCode are written IN the create, not later. A hat with
      // no members is readable by nobody, so creating one without claiming it
      // would lock its own owner out on the very next load.
      const createHat = async () => {
        const joinCode = uuidv4().replace(/-/g, '').slice(0, 12);
        const uid = auth.currentUser?.uid;

        await set(ref(db, context.state.databaseTopKey), {
          drawnMeals: {},
          "meal-hats-list": [context.state.databaseTopKey],
          meals: {},
          "most-recent-database": context.state.databaseTopKey,
          "shopping-list": [],
          joinCode,
          members: uid ? { [uid]: { joined: true, code: joinCode, email: auth.currentUser?.email || null } } : {}
        });
      };

      try {
        const snapshot = await get(ref(db, context.state.databaseTopKey));
        if (!snapshot.exists()) {
          await createHat();
        }
      } catch (readError) {
        // Permission denied: either the hat doesn't exist (create is allowed)
        // or it exists and this user isn't a member (create will be refused
        // too, which is itself the answer).
        try {
          await createHat();
        } catch (createError) {
          console.warn(
            `Hat "${context.state.databaseTopKey}" exists and this account is not a member - an invite link is needed.`,
            readError.message
          );
        }
      }

      // If there are no meals in the state, fetch them from the database.
      if (!context.state.meals) {
        onValue(ref(db, `${context.state.databaseTopKey}/meals`), (snapshot) => {
          const data = snapshot.val();

          let mealsArray = [];

          // If data exists and it's an object, convert it to an array.
          if (data && typeof data === 'object') {
            mealsArray = Object.keys(data).map((key) => data[key]);
          }

          // Commit the fetched meals to the state.
          context.commit('setMeals', mealsArray);
        });
      }

      // If there are no drawnMealsWithHistory and drawnMeals in the state, fetch them from the database.
      if (!context.state.drawnMealsWithHistory && !context.state.drawnMeals) {
        // Bounded to a window rather than the whole node. This used to subscribe
        // to every meal ever drawn — growth measured in calendar time, not in
        // how much the hat is used — and then throw nearly all of it away: the
        // schedule renders 7 days, the calendar just marks days that are taken.
        //
        // Only safe once assignedDate is ISO everywhere in this hat, because the
        // query orders by the stored string. If the migration hasn't run (or
        // failed), fall back to the unfiltered read.
        const migrated = await context.dispatch('migrateDrawnMealDates');
        const drawnMealsRef = ref(db, `${context.state.databaseTopKey}/drawnMeals`);
        const source = migrated
          ? query(drawnMealsRef, orderByChild('assignedDate'), startAt(isoDaysAgo(DRAWN_MEALS_WINDOW_DAYS)))
          : drawnMealsRef;

        onValue(source, (snapshot) => {
          const data = snapshot.val();

          let sortedByDate = [];
          let futureDates = [];

          // If data exists and it's an object, convert it to an array and sort it by date.
          if (data && typeof data === 'object') {
            sortedByDate = Object.values(data).sort(compareByDate);

            // Only meals still to come. This used to subtract raw timestamps and
            // compare against -86400000, which meant "within the last 24 hours"
            // rather than "today or later" — so whether yesterday's dinner still
            // counted depended on what time of day you looked.
            futureDates = sortedByDate.filter((meal) => isUpcoming(meal.assignedDate));
          }

          // Commit the fetched drawnMealsWithHistory and drawnMeals to the state.
          context.commit('setDrawnMealsWithHistory', sortedByDate);
          context.commit('setDrawnMeals', futureDates);
        });
      }

      // If there's no mealHatsList in the state, fetch it from the database.
      if (!context.state.mealHatsList && context.getters.primaryDatabaseTopKey) {
        onValue(ref(db, `${context.getters.primaryDatabaseTopKey}/meal-hats-list`), (snapshot) => {
          const data = snapshot.val();

          // Commit the fetched mealHatsList to the state.
          context.commit('setMealHatsList', data);
        });
      }

      // If there's no mostRecentDatabase in the state, fetch it from the database.
      if (!context.state.mostRecentDatabase) {
        onValue(ref(db, `${context.state.databaseTopKey}/most-recent-database`), (snapshot) => {
          const data = snapshot.val();

          // Commit the fetched mealHatsList to the state.
          context.commit('setMostRecentDatabase', data);
        });
      }

      // If there's no showTutorial in the state, fetch it from the database.
      if (context.state.showTutorial === null) {
        onValue(ref(db, `${context.state.databaseTopKey}/show-tutorial`), (snapshot) => {
          const data = snapshot.val();

          // Commit the fetched showTutorial to the state.
          if (data === null) {
            context.commit('setShowTutorial', true);
          } else {
            context.commit('setShowTutorial', data);
          }
        });
      }

      // Load the unified grocery catalog.
      if (Object.keys(context.state.groceryCatalog).length === 0) {
        onValue(ref(db, `${context.state.databaseTopKey}/grocery-catalog`), (snapshot) => {
          context.commit('setGroceryCatalog', snapshot.val());
        });
      }

      // Which fridge belongs to this hat.
      //
      // Subscribed the same way as mirrorFeedKey, and guarded the same way —
      // on "have we subscribed for this hat", not on the value being empty.
      // Most hats have no fridge, so null is the NORMAL answer here, and an
      // emptiness check would attach a fresh listener on every guarded
      // navigation.
      //
      // This is what lets a signed-in phone open the fridge without the secret
      // ever being pasted into it: the pointer is readable only by the hat's
      // members, and the wall tablet — which is a member of nothing — carries
      // the key in its URL instead.
      if (context.state.fridgeKeySubscribedFor !== context.state.databaseTopKey) {
        context.commit('setFridgeKeySubscribedFor', context.state.databaseTopKey);
        onValue(ref(db, `${context.state.databaseTopKey}/fridgeKey`), (snapshot) => {
          const key = snapshot.val();
          context.commit('setFridgeKeyForHat', key);

          // Subscribe here rather than only on the /fridge route.
          //
          // The SHOPPING LIST needs the timers: a staple with a live timer is
          // in the house and must stay off the list. Waiting for someone to
          // visit /fridge first would mean the list quietly fell back to the
          // 60-day guess for the whole session — a wrong answer that looks
          // exactly like a right one.
          //
          // `subscribe` is guarded on its own subscribedTo, so dispatching it
          // on every guarded navigation costs nothing.
          if (key) context.dispatch('fridge/subscribe', key);
        });
      }

      // Initialize unified shopping list
      if (Object.keys(context.state.shoppingList).length === 0) {
        onValue(ref(db, `${context.state.databaseTopKey}/shopping-list`), (snapshot) => {
          const data = snapshot.val();
          context.commit('setShoppingList', data || {});
        });
      }

      // Magic Mirror feed key. Null for every hat that has never turned the
      // feed on, which is the normal case — the read costs one small node and
      // is what tells the MealHats screen which half of the panel to render.
      if (context.state.mirrorFeedSubscribedFor !== context.state.databaseTopKey) {
        context.commit('setMirrorFeedSubscribedFor', context.state.databaseTopKey);
        onValue(ref(db, `${context.state.databaseTopKey}/mirrorFeedKey`), (snapshot) => {
          context.commit('setMirrorFeedKey', snapshot.val());
          context.dispatch('publishMirrorFeedIfStale');
        });
      }
    },

    // Republish on app open, at most every six hours.
    //
    // Drawing already republishes, and that covers the schedule CHANGING. This
    // covers the schedule merely getting older: the feed carries a fixed window
    // of days, so without a periodic refresh a hat that is drawn a month ahead
    // and then left alone would watch the mirror empty out from the front.
    async publishMirrorFeedIfStale (context) {
      if (!context.state.mirrorFeedKey) return;

      const stamp = `mealHat.mirrorFeed.lastPublish.${context.state.databaseTopKey}`;
      const last = Number(window.localStorage.getItem(stamp) || 0);
      if (Date.now() - last < 6 * 60 * 60 * 1000) return;

      // Written BEFORE the publish, not after. A hat whose publish keeps
      // failing (rules, offline, a half-open socket) would otherwise retry on
      // every snapshot callback for the whole session.
      window.localStorage.setItem(stamp, String(Date.now()));
      await context.dispatch('publishMirrorFeed');
    },
    async setDBValue (context, dbEntry) {
      const timestamp = Date.now();
      const uuid = uuidv4();
      const valueWithId = { ...dbEntry.value, id: `${timestamp}-${uuid}` };
      return set(ref(db, `${context.state.databaseTopKey}/${dbEntry.path}/${timestamp}-${uuid}`), removeNaNAndUndefined(valueWithId));
    },
    // Record that a meal was ACTUALLY cooked, not merely drawn.
    //
    // The draw weights by how overdue a meal is, and it used to read the drawn
    // date — a plan, not an event. A meal drawn onto Tuesday and then not made
    // still counted as recent and stayed unlikely for its whole interval, so
    // the meals most often skipped were the ones the hat kept skipping.
    //
    // Written per-key rather than by writing the meal back whole: meals are a
    // shared collection and someone else may be editing the same one.
    async markMealCooked (context, { mealId, date }) {
      if (!context.state.databaseTopKey || !mealId || !date) return;

      // Meals are stored as a MAP keyed by the meal's own uuid — `state.meals`
      // is an array only because the subscription flattens it. Writing by array
      // index would land on whatever meal happened to sort into that slot.
      return update(ref(db, `${context.state.databaseTopKey}/meals/${mealId}`), {
        lastCooked: date
      });
    },

    async updateDBValue (context, dbEntry) {
      return set(ref(db, `${context.state.databaseTopKey}/${dbEntry.path}`), removeNaNAndUndefined(dbEntry.value));
    },
    // Surgically merge a map of child keys into a node. Unlike updateDBValue's
    // set(), this only touches the keys present in dbEntry.value (a value of null
    // deletes that key) and leaves every sibling key untouched — use this for any
    // shared collection where a full overwrite could clobber concurrent edits.
    async mergeDBValue (context, dbEntry) {
      return update(ref(db, `${context.state.databaseTopKey}/${dbEntry.path}`), removeNaNAndUndefined(dbEntry.value));
    },
    async updateUserDBValue (context, dbEntry) {
      const userDatabaseTopKey = context.getters.primaryDatabaseTopKey;
      return set(ref(db, `${userDatabaseTopKey}/${dbEntry.path}`), removeNaNAndUndefined(dbEntry.value));
    },
    /**
     * Put meals on dates — the whole draw, in ONE atomic write.
     *
     * `assignments` is [{ meal, isoDate }].
     *
     * Previously each caller looped and issued two set() calls per day: one to
     * append the drawnMeals record, one to rewrite the meal with its new
     * drawnDates. A fortnight's draw was 28 separate round-trips, and any
     * failure partway through left half a schedule with nothing to say so.
     *
     * Firebase update() with slash-separated keys applies every path or none,
     * so a draw now lands completely or not at all. It also only touches the
     * keys named here — sibling meals and anyone else's concurrent edits are
     * left alone, which set() on a parent node could not promise.
     */
    async applyDraw (context, { assignments }) {
      if (!context.state.databaseTopKey || !assignments?.length) return;

      const updates = {};

      // Several days can land on the SAME meal within one draw, so accumulate
      // the meal's drawnDates across the batch instead of deriving each one from
      // the original record — otherwise the last write would drop the others.
      const mealsInFlight = {};

      assignments.forEach(({ meal, isoDate }) => {
        if (!meal?.id || !isoDate) return;

        const drawnMealId = `${Date.now()}-${uuidv4()}`;
        updates[`drawnMeals/${drawnMealId}`] = {
          id: drawnMealId,
          mealId: meal.id,
          assignedDate: isoDate
        };

        const current = mealsInFlight[meal.id] || meal;
        mealsInFlight[meal.id] = withDrawnDate(current, isoDate);
      });

      Object.values(mealsInFlight).forEach((meal) => {
        updates[`meals/${meal.id}`] = removeNaNAndUndefined({ ...meal });
      });

      if (!Object.keys(updates).length) return;

      await update(ref(db, context.state.databaseTopKey), updates);

      // A draw is the moment the schedule changes, so it is the moment the
      // mirror's copy of it goes stale. No throttle here — this is the event
      // the feed exists to carry. No-ops unless the hat has a feed key.
      await context.dispatch('publishMirrorFeed');
    },

    // ------------------------------------------------------------------
    // Magic Mirror feed. See src/assets/javascript/mirrorFeed.js for why this
    // exists: the mirror used to read the whole hat over unauthenticated REST
    // and the 2026-08-19 lockdown ended that.
    //
    // The secret must never live in Meal Hat's public bundle, so it is
    // generated per-hat at runtime and stored on the hat itself, where only
    // its members can read it.
    async ensureMirrorFeedKey (context) {
      const topKey = context.state.databaseTopKey;
      if (!topKey) return null;

      const existing = context.state.mirrorFeedKey;
      if (typeof existing === 'string' && existing.length >= 16) return existing;

      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      const key = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');

      await set(ref(db, `${topKey}/mirrorFeedKey`), key);
      context.commit('setMirrorFeedKey', key);

      return key;
    },

    async publishMirrorFeed (context) {
      const topKey = context.state.databaseTopKey;
      const secret = context.state.mirrorFeedKey;
      if (!topKey || !secret) return;

      // Publish from what the database holds, not from this device's state.
      // state.drawnMeals is a trailing WINDOW already filtered to upcoming
      // entries, and a draw that just landed may not have echoed back through
      // onValue yet — either would publish a schedule shorter than the real one.
      let drawnMeals = null;
      let meals = null;

      try {
        const [drawnSnapshot, mealsSnapshot] = await Promise.all([
          get(ref(db, `${topKey}/drawnMeals`)),
          get(ref(db, `${topKey}/meals`))
        ]);
        drawnMeals = drawnSnapshot.val();
        meals = mealsSnapshot.val();
      } catch (error) {
        console.error('Could not read the schedule to publish the mirror feed: ', error);
        return;
      }

      const feed = buildMirrorFeed(drawnMeals, meals);

      try {
        await set(ref(db, `mirrorFeed/${topKey}/${secret}`), feed);
      } catch (error) {
        // A mirror showing a stale schedule is not worth interrupting
        // anyone's draw over.
        console.error('Could not publish the mirror feed: ', error);
      }
    },

    /**
     * Rewrite any legacy `assignedDate` on this hat to ISO, once.
     *
     * Needed before drawnMeals can be range-queried: Firebase orders by the
     * stored string, and the old toDateString() form ("Wed Aug 19 2026") sorts
     * alphabetically — "Fri" before "Mon" before "Sat" — which is nonsense as a
     * date order. Reads elsewhere tolerate both formats; the QUERY cannot.
     *
     * Gated on a per-hat marker so the app can switch to the query in the same
     * release that ships the migration, instead of waiting for every device to
     * have visited once. A hat that hasn't been migrated is read in full (as it
     * always was), repaired, and marked; after that it is queried.
     *
     * Idempotent, and one atomic write. Records whose date cannot be parsed are
     * left alone rather than nulled — but the marker is still set, because
     * retrying forever would be worse than one unparseable row.
     *
     * Returns true once the hat is known to be ISO-only.
     */
    async migrateDrawnMealDates (context) {
      const topKey = context.state.databaseTopKey;
      if (!topKey) return false;

      try {
        const marker = await get(ref(db, `${topKey}/schema/drawnMealsDateFormat`));
        if (marker.val() === DRAWN_MEALS_SCHEMA) return true;

        const snapshot = await get(ref(db, `${topKey}/drawnMeals`));
        const rows = snapshot.val() || {};

        const updates = {};
        let unparseable = 0;

        Object.entries(rows).forEach(([key, row]) => {
          if (!row || typeof row !== 'object') return;

          const iso = toISODate(row.assignedDate);
          if (!iso) {
            unparseable++;
            return;
          }
          if (iso !== row.assignedDate) {
            updates[`drawnMeals/${key}/assignedDate`] = iso;
          }
        });

        updates['schema/drawnMealsDateFormat'] = DRAWN_MEALS_SCHEMA;

        await update(ref(db, topKey), updates);

        console.log(
          `Migrated ${Object.keys(updates).length - 1} drawn meal dates to ISO` +
          (unparseable ? ` (${unparseable} left alone — unreadable date)` : '')
        );

        return true;
      } catch (error) {
        // Fall back to loading the node whole. Slower, but correct — better than
        // a range query returning a partial schedule.
        console.error('Could not migrate drawn meal dates; loading unfiltered:', error);
        return false;
      }
    },

    /**
     * Move or remove existing schedule rows, and their meals' drawn history,
     * in ONE atomic write.
     *
     * `rows` is [{ id, mealId, assignedDate }] to write, or [{ id, value: null }]
     * to delete. `meals` is the already-updated meal records.
     *
     * Reordering the schedule used to be four independent set() calls and
     * deleting a meal two, with no ordering guarantee between them. An
     * interruption could leave the schedule showing one arrangement while the
     * meals' drawnDates recorded another — and since drawnDates drives
     * minDaysBetween, that quietly changes what can be drawn next time.
     */
    async reassignDrawnMeals (context, { rows = [], meals = [] }) {
      if (!context.state.databaseTopKey) return;

      const updates = {};

      rows.forEach((row) => {
        if (!row?.id) return;
        updates[`drawnMeals/${row.id}`] = row.value === null
          ? null
          : removeNaNAndUndefined({ id: row.id, mealId: row.mealId, assignedDate: row.assignedDate });
      });

      meals.forEach((meal) => {
        if (!meal?.id) return;
        updates[`meals/${meal.id}`] = removeNaNAndUndefined({ ...meal });
      });

      if (!Object.keys(updates).length) return;

      await update(ref(db, context.state.databaseTopKey), updates);
    },

    // Does a hat with this name already exist?
    //
    // This used to be answered from `allHatsList`, which was filled by an
    // onValue subscription on the DATABASE ROOT — every signed-in client
    // downloaded every other account's meals, shopping lists and grocery
    // catalogs, in full and on every session, just to call Object.keys() on the
    // result. That is both the privacy hole (the root was readable
    // unauthenticated, so those keys — which are email addresses — were public)
    // and the reason the root could not be closed off in the security rules.
    //
    // One targeted read instead. It is only asked when someone types a hat name
    // into "Add a hat", and if the answer is yes they are about to load that
    // hat anyway.
    //
    // Returns false rather than throwing if the read is refused: a denied
    // lookup should send you down the "create it?" path, not break the screen.
    async hatExists (context, hatName) {
      if (!hatName) return false;

      try {
        const snapshot = await get(ref(db, hatName));
        return snapshot.exists();
      } catch (error) {
        console.error('Could not check whether the hat exists:', error);
        return false;
      }
    },
    /**
     * Create a hat and become its first member.
     *
     * One atomic write, and it doubles as the existence check: the rules allow
     * writing a hat you are not a member of ONLY when it does not exist yet. So
     * if this is refused, the name is already taken by a hat you have no access
     * to — which is exactly when the user needs an invite link rather than a
     * "create it?" prompt.
     */
    async createNewHat (context, dBTitle) {
      if (!dBTitle) {
        return Promise.reject(new Error('dBTitle is required'));
      }

      const uid = auth.currentUser?.uid;
      if (!uid) return Promise.reject(new Error('Not signed in.'));

      const joinCode = uuidv4().replace(/-/g, '').slice(0, 12);

      await update(ref(db, dBTitle), {
        joinCode,
        // The email is stored so the members list can show a person rather than
        // a uid. Rules key on uid; this is purely a label for the roster, and
        // only visible to people already in the hat.
        [`members/${uid}`]: { joined: true, code: joinCode, email: auth.currentUser?.email || null },
        'most-recent-database': dBTitle
      });

      return joinCode;
    },

    /**
     * Join an existing hat using the code from its share link.
     *
     * The code is never compared here — it is checked server-side by the rules
     * against the hat's own joinCode, which the client cannot read until it is
     * a member. A wrong or missing code is a permission error, not a silent
     * no-op.
     */
    async joinHatWithCode (context, { hatName, code }) {
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error('Not signed in.');
      if (!hatName) throw new Error('No hat name.');

      await set(ref(db, `${hatName}/members/${uid}`), {
        joined: true,
        code: code || null,
        email: auth.currentUser?.email || null
      });
      return true;
    },

    /**
     * Who is in a hat. Readable only by its members, which is the point.
     *
     * `isSelf` is computed here rather than in the component so the "you cannot
     * remove yourself" guard has one definition.
     */
    async getHatMembers (context, hatName) {
      try {
        const snapshot = await get(ref(db, `${hatName}/members`));
        const members = snapshot.val() || {};
        const myUid = auth.currentUser?.uid;

        return Object.entries(members).map(([uid, record]) => ({
          uid,
          email: record?.email || null,
          isSelf: uid === myUid
        })).sort((a, b) => (a.email || a.uid).localeCompare(b.email || b.uid));
      } catch (error) {
        console.error('Could not read hat members:', error);
        return [];
      }
    },

    /**
     * Remove somebody from a hat.
     *
     * Refuses to remove YOU. Not politeness — a hat with no members is readable
     * by nobody, so removing yourself from a hat you are alone in would destroy
     * access to it permanently, with no way back short of a CLI write. Since
     * you can never remove yourself, the last member can never be removed.
     */
    async removeHatMember (context, { hatName, uid }) {
      if (!hatName || !uid) throw new Error('Missing hat or member.');
      if (uid === auth.currentUser?.uid) {
        throw new Error('You cannot remove yourself from a hat.');
      }

      await set(ref(db, `${hatName}/members/${uid}`), null);
      return true;
    },

    /** The share code for a hat. Readable only by its members, by design. */
    async getHatJoinCode (context, hatName) {
      try {
        const snapshot = await get(ref(db, `${hatName}/joinCode`));
        return snapshot.val();
      } catch (error) {
        console.error('Could not read the hat join code:', error);
        return null;
      }
    },
  },
  modules: {
    // The fridge, ported from perishable. Namespaced because it is reached by
    // a different door — the wall tablet arrives with a capability key and no
    // Google session — so its state must be able to exist while userEmail is
    // null and no hat is loaded.
    fridge
  }
})
