import { createApp, h } from 'vue'
import { createPinia } from 'pinia'
import { NConfigProvider, NMessageProvider, NDialogProvider, NNotificationProvider } from 'naive-ui'
import App from './App.vue'
import router from './router'

const app = createApp({
  setup() {
    return () => h(NConfigProvider, null, {
      default: () => h(NMessageProvider, null, {
        default: () => h(NDialogProvider, null, {
          default: () => h(NNotificationProvider, null, {
            default: () => h(App)
          })
        })
      })
    })
  }
})
app.use(createPinia())
app.use(router)
app.mount('#app')
