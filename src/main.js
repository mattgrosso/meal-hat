import { createApp } from 'vue';
import App from './App.vue';
import store from './store';
import router from './router';
// Only the Bootstrap partials this app uses — see the file for the list and
// why each is there. Was bootstrap.min.css whole (221KB raw / 30KB gzipped).
import "./assets/scss/bootstrap.scss";
import "bootstrap";
// v-calendar is NOT registered globally any more. It was app.use()'d here, so
// its component set and stylesheet loaded on every visit, while only Draw Meals
// and Show Meals ever render a date picker. Those two pull it in themselves, as
// an async component.
import './registerServiceWorker'

const app = createApp(App);

app.use(store);

app.use(router);

app.mount("#app");