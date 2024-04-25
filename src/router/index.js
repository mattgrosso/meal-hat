import { createRouter, createWebHashHistory } from 'vue-router';
import store from '@/store';
import Login from '@/components/Login.vue';
import Home from '@/components/Home.vue';
import AddMeal from '@/components/AddMeal.vue';
import DrawMeals from '@/components/DrawMeals.vue';
import ShowMeals from '@/components/ShowMeals.vue';
import ShoppingList from '@/components/ShoppingList.vue';
import MealHats from '@/components/MealHats.vue';

const loggedIn = () => {
  const databaseTopKeyFromLocalStorage = window.localStorage.getItem('mealHatDatabaseTopKey');
  const userEmailFromLocalStorage = window.localStorage.getItem('mealHatUserEmail');

  if (store.getters.databaseTopKey && store.getters.userEmail) {
    store.dispatch('initializeDB');
    return true;
  } else if (databaseTopKeyFromLocalStorage && userEmailFromLocalStorage) {
    store.dispatch('updateDatabaseTopKey', databaseTopKeyFromLocalStorage);
    store.commit('setUserEmail', userEmailFromLocalStorage);
    store.dispatch('initializeDB');
    return true;
  } else if (store.getters.userEmail) {
    const topKey = store.state.mostRecentDatabase || store.getters.userEmail;
    store.dispatch('updateDatabaseTopKey', topKey);
    store.dispatch('initializeDB');
    return true;
  } else {
    return false;
  }
};

const routes = [
  {
    path: '/login',
    component: Login,
    meta: {
      requiresLogin: false
    },
  },
  {
    path: '/',
    name: 'Home',
    component: Home,
    meta: {
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/add-meal/:id?',
    name: 'AddMeal',
    component: AddMeal,
    meta: {
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/draw-meals',
    component: DrawMeals,
    meta: {
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/show-meals',
    component: ShowMeals,
    meta: {
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/shopping-list',
    name: 'ShoppingList',
    component: ShoppingList,
    meta: {
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/meal-hats/:sharedMealHatName?',
    name: 'MealHats',
    component: MealHats,
    meta: {
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes
});

export default router;