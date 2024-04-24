import { createApp } from 'vue';
import App from './App.vue';
import store from './store';
import router from './router';
import vue3GoogleLogin from 'vue3-google-login';
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap";
import VCalendar from 'v-calendar';
import 'v-calendar/style.css';
import './registerServiceWorker'

const app = createApp(App);

app.use(store);

app.use(vue3GoogleLogin, {
  clientId: '871807065045-mo4955ma7sf3etvkrqbrqn6j1vmkghca.apps.googleusercontent.com'
});

app.use(router);

app.use(VCalendar, {});

app.mount("#app");