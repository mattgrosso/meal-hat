import { createApp } from 'vue';
import App from './App.vue';
import store from './store';
import { createRouter, createWebHashHistory } from 'vue-router';
import vue3GoogleLogin from 'vue3-google-login';
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap";
import VCalendar from 'v-calendar';
import 'v-calendar/style.css';

import Login from './components/Login.vue';
import Home from './components/Home.vue';
import AddMeal from './components/AddMeal.vue';
import DrawMeals from './components/DrawMeals.vue';
import ShowMeals from './components/ShowMeals.vue';
import EditMeal from './components/EditMeal.vue';
import ShoppingList from './components/ShoppingList.vue';
import MealHats from './components/MealHats.vue';

const app = createApp(App);

app.use(store);

app.use(vue3GoogleLogin, {
  clientId: '871807065045-mo4955ma7sf3etvkrqbrqn6j1vmkghca.apps.googleusercontent.com'
});

const loggedIn = () => {
  const databaseTopKeyFromLocalStorage = window.localStorage.getItem('mealHatDatabaseTopKey');
  const userEmailFromLocalStorage = window.localStorage.getItem('mealHatUserEmail');

  if (store.getters.databaseTopKey && store.getters.userEmail) {
    // TODO: Why am I initializing this DB everytime?
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
    path: '/add-meal',
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
    path: '/edit-meal/:id',
    name: 'EditMeal',
    component: EditMeal,
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

app.use(router);

app.use(VCalendar, {});

app.mount("#app");