import { createApp } from 'vue';
import App from './App.vue';
import store from './store';
import router from './router';
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap";
import VCalendar from 'v-calendar';
import 'v-calendar/style.css';
import './registerServiceWorker'

const app = createApp(App);

app.use(store);

app.use(router);

app.use(VCalendar, {});

app.mount("#app");