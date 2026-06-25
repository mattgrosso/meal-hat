import { createStore } from 'vuex';
import { initializeApp } from "firebase/app";
import { getDatabase, onValue, ref, set, get, update } from "firebase/database";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { v4 as uuidv4 } from 'uuid';
import router from '@/router';
import { analyzeDuplicates, findSimilar, aggregateMealIngredients, remapMealIngredients } from './ingredients';

const firebaseConfig = {
  apiKey: process.env.VUE_APP_GOOGLE_API_KEY,
  authDomain: "meal-hat.firebaseapp.com",
  projectId: "meal-hat",
  storageBucket: "meal-hat.appspot.com",
  messagingSenderId: "871807065045",
  appId: "1:871807065045:web:eaaf302a198f18c41a3b5c",
  databaseURL: "https://meal-hat-default-rtdb.firebaseio.com",
}

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

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
// const auth = getAuth();

export default createStore({
  state: {
    userEmail: null,
    databaseTopKey: null,
    mostRecentDatabase: null,
    showTutorial: null,
    allHatsList: null,
    meals: null,
    drawnMealsWithHistory: null,
    drawnMeals: null,

    // UNIFIED DATA MODEL
    groceryCatalog: {}, // Single source for all grocery items: id → { id, name, defaultUnits, defaultAisle, defaultLocation }
    shoppingList: {}, // Unified shopping list: id → { groceryId, quantity, units, aisle, location, source, mealId?, purchased }

    // DEPRECATED - keeping only for backward compatibility during initialization
    groceryItems: null,
    nonMealShoppingList: null,
    purchasedIngredients: {},
    nonMealGroceryItems: null,
    mealHatsList: null
  },
  getters: {
    getMeal: (state) => (id) => {
      return state.meals.find((meal) => meal.id === id);
    },
    getUserEmail (state) {
      return state.userEmail;
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
          // Try to get grocery item from catalog, with fallbacks
          let groceryItem = state.groceryCatalog[item.groceryId];

          // Fallback to old systems during migration
          if (!groceryItem && item.groceryId) {
            groceryItem = (state.groceryItems && state.groceryItems[item.groceryId]) ||
                         (state.nonMealGroceryItems && state.nonMealGroceryItems[item.groceryId]);
          }

          // If still no grocery item found, try to use item's own properties
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

    // MIGRATION HELPERS
    migrateToUnifiedSystem: (state) => {
      console.log('Starting migration to unified shopping list system...');

      // Migrate nonMealShoppingList items to unified shoppingList
      if (state.nonMealShoppingList && typeof state.nonMealShoppingList === 'object') {
        Object.values(state.nonMealShoppingList).forEach(item => {
          const shoppingItemId = require('uuid').v4();

          // Ensure grocery catalog entry exists
          if (!state.groceryCatalog[item.id]) {
            state.groceryCatalog[item.id] = {
              id: item.id,
              name: item.name,
              defaultUnits: item.units || '',
              defaultAisle: item.aisle || 0
            };
          }

          state.shoppingList[shoppingItemId] = {
            id: shoppingItemId,
            groceryId: item.id,
            quantity: item.quantity || 1,
            units: item.units || '',
            aisle: item.aisle || 0,
            source: 'manual',
            purchased: false
          };
        });
        console.log('Migrated', Object.keys(state.nonMealShoppingList).length, 'manual items');
      }

      // Migrate drawnIngredients to unified shoppingList
      if (state.drawnMeals && state.meals && (state.groceryItems || state.groceryCatalog)) {
        const ingredients = {};

        state.drawnMeals.forEach(drawnMeal => {
          const meal = state.meals.find(meal => meal.id === drawnMeal.mealId);
          if (meal && meal.ingredients) {
            meal.ingredients.forEach(ingredient => {
              const groceryItem = state.groceryCatalog[ingredient.groceryItemId] ||
                                (state.groceryItems && state.groceryItems[ingredient.groceryItemId]);
              if (groceryItem) {
                const id = groceryItem.id;
                if (ingredients[id]) {
                  ingredients[id].quantity += ingredient.quantity;
                } else {
                  ingredients[id] = { ...groceryItem, quantity: ingredient.quantity };
                }
              }
            });
          }
        });

        // Add meal ingredients to unified shopping list
        Object.values(ingredients).forEach(item => {
          const shoppingItemId = require('uuid').v4();
          const purchasedAmount = state.purchasedIngredients[item.id] || 0;
          const remainingQuantity = item.quantity - purchasedAmount;

          // Ensure grocery catalog entry exists
          if (!state.groceryCatalog[item.id]) {
            state.groceryCatalog[item.id] = {
              id: item.id,
              name: item.name,
              defaultUnits: item.units || item.defaultUnits || '',
              defaultAisle: item.aisle || item.defaultAisle || 0,
              defaultLocation: item.location || item.defaultLocation || null
            };
          }

          if (remainingQuantity > 0) {
            const catalogEntry = state.groceryCatalog[item.id];
            state.shoppingList[shoppingItemId] = {
              id: shoppingItemId,
              groceryId: item.id,
              quantity: remainingQuantity,
              units: item.units || item.defaultUnits || '',
              aisle: item.aisle || item.defaultAisle || 0,
              location: item.location || (catalogEntry && catalogEntry.defaultLocation) || null,
              source: 'meal',
              purchased: false
            };
          }
        });
        console.log('Migrated', Object.keys(ingredients).length, 'meal ingredients');
      }

      console.log('Migration complete! Unified shopping list has', Object.keys(state.shoppingList).length, 'items');
      return true;
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
    setShowTutorial (state, value) {
      state.showTutorial = value;
    },
    setAllHatsList (state, allHatsList) {
      state.allHatsList = allHatsList;
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
    updateShoppingListItem (state, { id, updates }) {
      if (state.shoppingList[id]) {
        state.shoppingList[id] = { ...state.shoppingList[id], ...updates };
      }
    },
    removeFromShoppingList (state, itemId) {
      delete state.shoppingList[itemId];
    },
    markItemPurchased (state, { itemId, purchased = true }) {
      if (state.shoppingList[itemId]) {
        state.shoppingList[itemId].purchased = purchased;
      }
    },
    setGroceryItems (state, groceryItems) {
      state.groceryItems = groceryItems;
    },
    setNonMealShoppingList (state, nonMealShoppingList) {
      state.nonMealShoppingList = nonMealShoppingList;
    },
    setPurchasedIngredients (state, purchasedIngredients) {
      state.purchasedIngredients = purchasedIngredients;
    },
    purchaseIngredient (state, config) {
      if (state.purchasedIngredients[config.ingredientId]) {
        state.purchasedIngredients[config.ingredientId] += config.quantity;
      } else {
        state.purchasedIngredients[config.ingredientId] = config.quantity;
      }
    },
    setNonMealGroceryItems (state, nonMealGroceryItems) {
      state.nonMealGroceryItems = nonMealGroceryItems;
    },
    setMealHatsList (state, mealHatsList) {
      state.mealHatsList = mealHatsList;
    },
    clearState (state) {
      state.meals = null;
      state.drawnMealsWithHistory = null;
      state.drawnMeals = null;

      // Clear new unified data
      state.groceryCatalog = {};
      state.shoppingList = {};

      // Clear deprecated data
      state.groceryItems = null;
      state.nonMealShoppingList = null;
      state.purchasedIngredients = {};
      state.nonMealGroceryItems = null;
      state.mealHatsList = null;
    }
  },
  actions: {
    // Migrate from old split system to unified system
    async migrateToUnifiedSystem (context) {
      console.log('Migrating to unified shopping list system...');

      // Run the migration
      const migrationSuccess = context.getters.migrateToUnifiedSystem;

      if (migrationSuccess) {
        // Merge the migrated items in rather than overwriting the nodes, so a
        // concurrent edit (e.g. another device that already migrated, or a manual
        // item added mid-migration) can't be clobbered.
        await context.dispatch('mergeDBValue', {
          path: 'shopping-list',
          value: context.state.shoppingList
        });

        await context.dispatch('mergeDBValue', {
          path: 'grocery-catalog',
          value: context.state.groceryCatalog
        });

        // Clear old data from database
        await context.dispatch('updateDBValue', { path: 'non-meal-shopping-list', value: null });
        await context.dispatch('updateDBValue', { path: 'purchased-ingredients', value: {} });

        // Clear old data from state
        context.commit('setNonMealShoppingList', null);
        context.commit('setPurchasedIngredients', {});

        console.log('Migration completed and saved to database');
        return true;
      }
      return false;
    },

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

      // 3) Delete the orphaned catalog + legacy grocery-items entries.
      const catalogDeletes = {};
      const legacyDeletes = {};
      oldIds.forEach((id) => { catalogDeletes[id] = null; legacyDeletes[id] = null; });
      await context.dispatch('mergeDBValue', { path: 'grocery-catalog', value: catalogDeletes });
      await context.dispatch('mergeDBValue', { path: 'grocery-items', value: legacyDeletes });

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
        catalog: context.state.groceryCatalog,
        legacyItems: context.state.groceryItems
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

      // Queue the freshly-generated meal items.
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

        shoppingListUpdates[shoppingItemId] = {
          id: shoppingItemId,
          groceryId: item.id,
          quantity: item.quantity,
          units: item.units || item.defaultUnits || '',
          aisle: item.aisle || item.defaultAisle || 0,
          location: item.location || (catalogEntry && catalogEntry.defaultLocation) || null,
          source: 'meal',
          mealId: item.mealId,
          purchased: false
        };
      });

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
      const auth = getAuth();
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
      context.commit('setAllHatsList', null);
      context.commit('setMeals', null);
      context.commit('setDrawnMealsWithHistory', null);
      context.commit('setDrawnMeals', null);

      // Clear new unified data structures
      context.commit('setGroceryCatalog', {});
      context.commit('setShoppingList', {});

      // Clear deprecated data
      context.commit('setGroceryItems', null);
      context.commit('setNonMealShoppingList', null);
      context.commit('setPurchasedIngredients', {});
      context.commit('setNonMealGroceryItems', null);
      context.commit('setMealHatsList', null);

      window.localStorage.removeItem('mealHatDatabaseTopKey');
      window.localStorage.removeItem('mealHatUserEmail');
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

      // Check if the databaseTopKey exists in the database.
      try {
        const snapshot = await get(ref(db, context.state.databaseTopKey));
        if (!snapshot.exists()) {
          // If the databaseTopKey doesn't exist, create a new top-level key with an empty object.
          await set(ref(db, context.state.databaseTopKey), {
            drawnMeals: {},
            "meal-hats-list": [context.state.databaseTopKey],
            meals: {},
            "most-recent-database": context.state.databaseTopKey,
            "shopping-list": []
          });
        }
      } catch (error) {
        console.error('Error checking databaseTopKey: ', error);
      }

      // If there are isn't a list of all hats in the state, fetch them from the database.
      if (!context.state.allHatsList) {
        onValue(ref(db), (snapshot) => {
          const keys = Object.keys(snapshot.val());

          // Commit the list of all hats to the state.
          context.commit('setAllHatsList', keys);
        });
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
        onValue(ref(db, `${context.state.databaseTopKey}/drawnMeals`), (snapshot) => {
          const data = snapshot.val();

          let sortedByDate = [];
          let futureDates = [];

          // If data exists and it's an object, convert it to an array and sort it by date.
          if (data && typeof data === 'object') {
            const drawnMealsArray = Object.keys(data).map((key) => data[key]);

            sortedByDate = drawnMealsArray.sort((a, b) => {
              return new Date(a.assignedDate) - new Date(b.assignedDate);
            });

            // Filter the sorted array to only include meals with future dates.
            futureDates = sortedByDate.filter((meal) => {
              const mealDate = new Date(meal.assignedDate).getTime();
              const today = new Date().getTime();
              const difference = mealDate - today;
              const oneDayAgo = -86400000;

              return difference > oneDayAgo;
            });
          }

          // Commit the fetched drawnMealsWithHistory and drawnMeals to the state.
          context.commit('setDrawnMealsWithHistory', sortedByDate);
          context.commit('setDrawnMeals', futureDates);
        });
      }

      // If there's no groceryItems in the state, fetch it from the database.
      if (!context.state.groceryItems) {
        onValue(ref(db, `${context.state.databaseTopKey}/grocery-items`), (snapshot) => {
          const data = snapshot.val();

          // Commit the fetched groceryItems to the state.
          context.commit('setGroceryItems', data);
        });
      }

      // If there's no nonMealShoppingList in the state, fetch it from the database.
      if (!context.state.nonMealShoppingList) {
        onValue(ref(db, `${context.state.databaseTopKey}/non-meal-shopping-list`), (snapshot) => {
          const data = snapshot.val();

          // Commit the fetched nonMealShoppingList to the state.
          context.commit('setNonMealShoppingList', data);
        });
      }

      // If there's no purchasedIngredients in the state, fetch it from the database.
      if (!context.state.purchasedIngredients || Object.keys(context.state.purchasedIngredients).length === 0) {
        onValue(ref(db, `${context.state.databaseTopKey}/purchased-ingredients`), (snapshot) => {
          const data = snapshot.val();

          // Commit the fetched purchasedIngredients to the state.
          context.commit('setPurchasedIngredients', data);
        });
      }

      // If there's no nonMealGroceryItems in the state, fetch it from the database.
      if (!context.state.nonMealGroceryItems) {
        onValue(ref(db, `${context.state.databaseTopKey}/non-meal-grocery-items`), (snapshot) => {
          const data = snapshot.val();

          // Commit the fetched nonMealGroceryItems to the state.
          context.commit('setNonMealGroceryItems', data);
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

      // INITIALIZE NEW UNIFIED DATA STRUCTURES
      // Initialize grocery catalog from existing groceryItems and nonMealGroceryItems
      if (Object.keys(context.state.groceryCatalog).length === 0) {
        onValue(ref(db, `${context.state.databaseTopKey}/grocery-catalog`), (snapshot) => {
          const data = snapshot.val();
          context.commit('setGroceryCatalog', data);
        });

        // Migration: populate catalog from old data if new structure doesn't exist
        if (!context.state.groceryCatalog || Object.keys(context.state.groceryCatalog).length === 0) {
          // Merge old groceryItems and nonMealGroceryItems into unified catalog
          const mergedCatalog = {};

          if (context.state.groceryItems) {
            Object.values(context.state.groceryItems).forEach(item => {
              mergedCatalog[item.id] = {
                id: item.id,
                name: item.name,
                defaultUnits: item.units || 'units',
                defaultAisle: item.aisle || null
              };
            });
          }

          if (context.state.nonMealGroceryItems) {
            Object.values(context.state.nonMealGroceryItems).forEach(item => {
              mergedCatalog[item.id] = {
                id: item.id,
                name: item.name,
                defaultUnits: item.units || 'units',
                defaultAisle: item.aisle || null
              };
            });
          }

          if (Object.keys(mergedCatalog).length > 0) {
            context.commit('setGroceryCatalog', mergedCatalog);
          }
        }
      }

      // Initialize unified shopping list
      if (Object.keys(context.state.shoppingList).length === 0) {
        onValue(ref(db, `${context.state.databaseTopKey}/shopping-list`), (snapshot) => {
          const data = snapshot.val();
          context.commit('setShoppingList', data || {});
        });
      }
    },
    purchaseIngredient (context, config) {
      context.commit('purchaseIngredient', config);

      const dbEntry = {
        path: 'purchased-ingredients',
        value: context.state.purchasedIngredients
      };

      context.dispatch('updateDBValue', dbEntry);
    },
    async setDBValue (context, dbEntry) {
      const timestamp = Date.now();
      const uuid = uuidv4();
      const valueWithId = { ...dbEntry.value, id: `${timestamp}-${uuid}` };
      return set(ref(db, `${context.state.databaseTopKey}/${dbEntry.path}/${timestamp}-${uuid}`), removeNaNAndUndefined(valueWithId));
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
    async createNewHat (context, dBTitle) {
      if (!dBTitle) {
        return Promise.reject(new Error("dBTitle is required"));
      }
      return set(ref(db, `${dBTitle}/most-recent-database`), dBTitle)
    },
  }
})
