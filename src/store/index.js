import { createStore } from 'vuex';
import { initializeApp } from "firebase/app";
import { getDatabase, onValue, ref, set } from "firebase/database";
import { decodeCredential } from 'vue3-google-login'
import { v4 as uuidv4 } from 'uuid';

const firebaseConfig = {
  apiKey: "AIzaSyAgRwQfTJo00U69by1TXcL5jQU9QNWZLAg",
  authDomain: "meal-hat.firebaseapp.com",
  projectId: "meal-hat",
  storageBucket: "meal-hat.appspot.com",
  messagingSenderId: "871807065045",
  appId: "1:871807065045:web:eaaf302a198f18c41a3b5c",
  databaseURL: "https://meal-hat-default-rtdb.firebaseio.com",
}

const db = getDatabase(initializeApp(firebaseConfig));

export default createStore({
  state: {
    userEmail: null,
    databaseTopKey: null,
    mostRecentDatabase: null,
    meals: null,
    drawnMealsWithHistory: null,
    drawnMeals: null,
    shoppingList: null,
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
      return state.userEmail.replaceAll(/[-!$%@^&*()_+|~=`{}[\]:";'<>?,./]/g, "-");
    }
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
    setMeals (state, meals) {
      state.meals = meals;
    },
    setDrawnMealsWithHistory (state, drawnMealsWithHistory) {
      state.drawnMealsWithHistory = drawnMealsWithHistory;
    },
    setDrawnMeals (state, drawnMeals) {
      state.drawnMeals = drawnMeals;
    },
    setShoppingList (state, shoppingList) {
      state.shoppingList = shoppingList;
    },
    setMealHatsList (state, mealHatsList) {
      state.mealHatsList = mealHatsList;
    },
    clearState (state) {
      state.meals = null;
      state.drawnMealsWithHistory = null;
      state.drawnMeals = null;
      state.shoppingList = null;
      state.mealHatsList = null;
    }
  },
  actions: {
    async login (context, resp) {
      const userData = decodeCredential(resp.credential);

      context.commit('setUserEmail', userData.email);

      if (context.state.userEmail) {
        context.dispatch('updateDatabaseTopKey', context.state.userEmail);
        window.localStorage.setItem('mealHatDatabaseTopKey', context.state.databaseTopKey);
        window.localStorage.setItem('mealHatUserEmail', context.state.userEmail);
        context.dispatch('initializeDB');
      } else {
        console.error("Login attempted but the user data didn't work");
      }

      return;
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
    initializeDB (context) {
      // If there's no databaseTopKey in the state, exit the action.
      if (!context.state.databaseTopKey || !context.state.userEmail) {
        return;
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
    },
    setDBValue (context, dbEntry) {
      const uuid = uuidv4();
      const valueWithId = { ...dbEntry.value, id: uuid };
      set(ref(db, `${context.state.databaseTopKey}/${dbEntry.path}/${uuid}`), valueWithId);
    },
    updateDBValue (context, dbEntry) {
      set(ref(db, `${context.state.databaseTopKey}/${dbEntry.path}`), dbEntry.value);
    },
    updateUserDBValue (context, dbEntry) {
      const userDatabaseTopKey = context.getters.primaryDatabaseTopKey;
      set(ref(db, `${userDatabaseTopKey}/${dbEntry.path}`), dbEntry.value);
    }
  }
})
