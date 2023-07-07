import { createStore } from 'vuex';
import { initializeApp } from "firebase/app";
import { getDatabase, onValue, ref, set } from "firebase/database";
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

const mealDrawnTooRecently = (meal, date) => {
  if (!meal.lastDrawn) {
    return false;
  }

  const lastDrawn = new Date(meal.lastDrawn);
  const daysSinceLastDrawn = Math.floor((date - lastDrawn) / (1000 * 60 * 60 * 24));

  return daysSinceLastDrawn < meal.minDaysBetween;
}

export default createStore({
  state: {
    meals: null,
    drawnMeals: null
  },
  getters: {
  },
  mutations: {
    setMeals (state, meals) {
      state.meals = meals;
    },
    setDrawnMeals (state, drawnMeals) {
      state.drawnMeals = drawnMeals;
    }
  },
  actions: {
    initializeDB (context) {
      onValue(ref(db, 'meals'), (snapshot) => {
        const data = snapshot.val();
        const mealsArray = Object.keys(data).map((key) => data[key]);
        context.commit('setMeals', mealsArray);
      });

      onValue(ref(db, 'drawnMeals'), (snapshot) => {
        const data = snapshot.val();

        const drawnMealsArray = Object.keys(data).map((key) => data[key]);
        const futureDates = drawnMealsArray.filter((meal) => {
          const mealDate = new Date(meal.assignedDate).getTime();
          const today = new Date().getTime();
          const difference = mealDate - today;
          const oneDayAgo = -86400000;

          return difference > oneDayAgo;
        });
        const sortedByDate = futureDates.sort((a, b) => {
          return new Date(a.assignedDate) - new Date(b.assignedDate);
        });

        context.commit('setDrawnMeals', sortedByDate);
      });
    },
    setDBValue (context, dbEntry) {
      const uuid = uuidv4();
      const valueWithId = { ...dbEntry.value, id: uuid };
      console.log('dbEntry for set: ', dbEntry);
      set(ref(db, `${dbEntry.path}/${uuid}`), valueWithId);
    },
    updateDBValue (context, dbEntry) {
      console.log('dbEntry for update: ', dbEntry);
      set(ref(db, `${dbEntry.path}`), dbEntry.value);
    },
    getRandomMeal (context, reducedMeals) {
      console.error('1');
      const meals = reducedMeals || { ...context.state.meals };
      const mealsArray = Object.keys(meals).map((key) => meals[key]);
      const randomIndex = Math.floor(Math.random() * mealsArray.length);

      if (mealDrawnTooRecently(mealsArray[randomIndex])) {
        console.error('2');
        return context.dispatch('getRandomMeal', mealsArray);
      }

      const randomMeal = meals[randomIndex];

      return randomMeal;
    }
  },
  modules: {
  }
})
