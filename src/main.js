import { createApp } from 'vue';
import App from './App.vue';
import store from './store';
import { createRouter, createWebHashHistory } from 'vue-router';
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap";
import VCalendar from 'v-calendar';
import 'v-calendar/style.css';

import Home from './components/Home.vue';
import AddMeal from './components/AddMeal.vue';
import DrawMeals from './components/DrawMeals.vue';
import ShowMeals from './components/ShowMeals.vue';
import EditMeal from './components/EditMeal.vue';

const app = createApp(App);

app.use(store);

const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home
  },
  {
    path: '/add-meal',
    component: AddMeal
  },
  {
    path: '/draw-meals',
    component: DrawMeals
  },
  {
    path: '/show-meals',
    component: ShowMeals
  },
  {
    name: 'EditMeal',
    path: '/edit-meal/:id',
    component: EditMeal
  }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes
});

app.use(router);

app.use(VCalendar, {});

app.mount("#app");