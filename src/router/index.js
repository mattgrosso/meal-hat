import { createRouter, createWebHashHistory } from 'vue-router';
import store from '@/store';

// Every screen is loaded on demand rather than bundled into one chunk.
//
// These were static imports, so opening the app downloaded all seven screens —
// including the shopping list, far and away the largest — before it could show
// you tonight's dinner. Home is the only route most visits ever touch.
//
// Login stays static: it is the fallback for an unauthenticated visit, and a
// chunk fetch is a poor thing to depend on at that moment.
import Login from '@/components/Login.vue';

const Home = () => import(/* webpackChunkName: "home" */ '@/components/Home.vue');
const AddMeal = () => import(/* webpackChunkName: "add-meal" */ '@/components/AddMeal.vue');
const DrawMeals = () => import(/* webpackChunkName: "draw-meals" */ '@/components/DrawMeals.vue');
const ShowMeals = () => import(/* webpackChunkName: "show-meals" */ '@/components/ShowMeals.vue');
const ShoppingList = () => import(/* webpackChunkName: "shopping-list" */ '@/components/ShoppingList.vue');
const MealHats = () => import(/* webpackChunkName: "meal-hats" */ '@/components/MealHats.vue');
const Fridge = () => import(/* webpackChunkName: "fridge" */ '@/components/Fridge.vue');

const loggedIn = () => {
  const databaseTopKeyFromLocalStorage = window.localStorage.getItem('mealHatDatabaseTopKey');
  const userEmailFromLocalStorage = window.localStorage.getItem('mealHatUserEmail');

  if (store.getters.databaseTopKey && store.state.userEmail) {
    store.dispatch('initializeDB');
    return true;
  } else if (databaseTopKeyFromLocalStorage && userEmailFromLocalStorage) {
    store.dispatch('updateDatabaseTopKey', databaseTopKeyFromLocalStorage);
    store.commit('setUserEmail', userEmailFromLocalStorage);
    store.dispatch('initializeDB');
    return true;
  } else if (store.state.userEmail) {
    const topKey = store.state.mostRecentDatabase || store.state.userEmail;
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
    meta: { requiresLogin: false },
  },
  {
    path: '/',
    name: 'Home',
    component: Home,
    meta: { requiresLogin: true }
  },
  {
    path: '/add-meal/:id?',
    name: 'AddMeal',
    component: AddMeal,
    meta: { requiresLogin: true }
  },
  {
    path: '/draw-meals',
    component: DrawMeals,
    meta: { requiresLogin: true }
  },
  {
    path: '/show-meals',
    component: ShowMeals,
    meta: { requiresLogin: true }
  },
  {
    path: '/add-groceries',
    redirect: '/shopping-list'
  },
  {
    path: '/shopping-list',
    name: 'ShoppingList',
    component: ShoppingList,
    meta: { requiresLogin: true }
  },
  {
    path: '/meal-hats/:sharedMealHatName?',
    name: 'MealHats',
    component: MealHats,
    meta: { requiresLogin: true }
  },
  {
    // The ONLY route that does not require login, besides the login screen
    // itself, and it is deliberate.
    //
    // The kitchen wall tablet is a Galaxy in Fully Kiosk. It cannot complete a
    // Google popup, and a lapsed session there fails silently — a blank kitchen
    // screen nobody notices for a week. It authorizes with the capability key
    // in its URL instead (/?k=<key>#/fridge) and an anonymous Firebase session,
    // which is what the fridge rules ask for.
    //
    // This is not a hole in the login guard: without a valid key the route
    // renders its own loud NOT-CONNECTED screen and reads nothing. A signed-in
    // phone reaching /fridge with no key in the URL falls back to the hat's
    // fridgeKey pointer, which only members can read.
    path: '/fridge',
    name: 'Fridge',
    component: Fridge,
    meta: { requiresLogin: false }
  }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes
});

// Single auth guard for every route that requires login — replaces the identical
// beforeEnter block that used to be copy-pasted onto each protected route.
router.beforeEach((to, from, next) => {
  if (to.meta.requiresLogin && !loggedIn()) {
    next('/login');
  } else {
    next();
  }
});

export default router;