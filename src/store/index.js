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

export default createStore({
  state: {
    meals: null,
    drawnMealsWithHistory: null,
    drawnMeals: null,
    shoppingList: null
  },
  getters: {
    getMeal: (state) => (id) => {
      return state.meals.find((meal) => meal.id === id);
    }
  },
  mutations: {
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

        const sortedByDate = drawnMealsArray.sort((a, b) => {
          return new Date(a.assignedDate) - new Date(b.assignedDate);
        });

        const futureDates = sortedByDate.filter((meal) => {
          const mealDate = new Date(meal.assignedDate).getTime();
          const today = new Date().getTime();
          const difference = mealDate - today;
          const oneDayAgo = -86400000;

          return difference > oneDayAgo;
        });
        

        context.commit('setDrawnMealsWithHistory', sortedByDate);
        context.commit('setDrawnMeals', futureDates);
      });

      onValue(ref(db, 'shopping-list'), (snapshot) => {
        const data = snapshot.val();
        context.commit('setShoppingList', data);
      });
    },
    setDBValue (context, dbEntry) {
      const uuid = uuidv4();
      const valueWithId = { ...dbEntry.value, id: uuid };
      set(ref(db, `${dbEntry.path}/${uuid}`), valueWithId);
    },
    updateDBValue (context, dbEntry) {
      set(ref(db, `${dbEntry.path}`), dbEntry.value);
    }
  }
})
