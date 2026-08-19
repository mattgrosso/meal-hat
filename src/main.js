import { createApp } from 'vue';
import App from './App.vue';
import store from './store';
import router from './router';
import "bootstrap/dist/css/bootstrap.min.css";
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