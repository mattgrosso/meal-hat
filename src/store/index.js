import { createStore } from 'vuex';
import { initializeApp } from "firebase/app";
import { getDatabase, onValue, ref, set, get } from "firebase/database";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { v4 as uuidv4 } from 'uuid';
import router from '@/router';

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
    
    // SIMPLIFIED UNIFIED DATA MODEL
    groceryCatalog: {}, // Single source for all grocery items: id → { id, name, defaultUnits, defaultAisle }
    shoppingList: {}, // Unified shopping list: id → { groceryId, quantity, units, aisle, source, mealId?, purchased }
    
    // DEPRECATED - keeping temporarily for migration
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
    // SIMPLIFIED GETTERS FOR NEW DATA MODEL
    shoppingListItems: (state) => {
      return Object.values(state.shoppingList || {})
        .map(item => ({
          ...item,
          groceryItem: state.groceryCatalog[item.groceryId] || { name: 'Unknown Item' }
        }))
        .sort((a, b) => (a.aisle || 999) - (b.aisle || 999));
    },
    unpurchasedShoppingItems: (state, getters) => {
      return getters.shoppingListItems.filter(item => !item.purchased);
    },
    
    // DEPRECATED GETTERS - keeping for backward compatibility during migration
    drawnIngredients: (state, getters) => {
      // Return items from new shopping list that came from meals
      return getters.shoppingListItems.filter(item => item.source === 'meal');
    },
    combinedShoppingList: (state, getters) => {
      // Return all shopping list items in old format for compatibility
      return getters.shoppingListItems;
    },
    unpurchasedIngredients: (state, getters) => {
      return getters.unpurchasedShoppingItems;
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

      // If there's no shoppingList in the state, fetch it from the database.
      if (!context.state.shoppingList) {
        onValue(ref(db, `${context.state.databaseTopKey}/shopping-list`), (snapshot) => {
          const data = snapshot.val();

          // Commit the fetched shoppingList to the state.
          context.commit('setShoppingList', data);
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
        onValue(ref(db, `${context.state.databaseTopKey}/unified-shopping-list`), (snapshot) => {
          const data = snapshot.val();
          context.commit('setShoppingList', data);
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
