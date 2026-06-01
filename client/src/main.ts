import { createApp, h, defineComponent, computed } from 'vue'
import { createPinia } from 'pinia'
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NNotificationProvider,
  darkTheme,
  zhCN,
  dateZhCN,
  type GlobalThemeOverrides,
} from 'naive-ui'
import App from './App.vue'
import router from './router'
import { useThemeStore } from './stores/theme'

const lightThemeOverrides: GlobalThemeOverrides = {
  common: {
    fontFamily: 'Plus Jakarta Sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontFamilyMono: 'JetBrains Mono, SF Mono, Consolas, monospace',
    primaryColor: '#0D9488',
    primaryColorHover: '#14B8A6',
    primaryColorPressed: '#0F766E',
    primaryColorSuppl: '#0D9488',
    infoColor: '#0D9488',
    infoColorHover: '#14B8A6',
    infoColorPressed: '#0F766E',
    successColor: '#10B981',
    successColorHover: '#34D399',
    successColorPressed: '#059669',
    warningColor: '#EA580C',
    warningColorHover: '#F97316',
    warningColorPressed: '#C2410C',
    errorColor: '#DC2626',
    errorColorHover: '#EF4444',
    errorColorPressed: '#B91C1C',
    bodyColor: '#F0FDFA',
    cardColor: '#FFFFFF',
    modalColor: '#FFFFFF',
    popoverColor: '#FFFFFF',
    tableColor: '#FFFFFF',
    actionColor: '#F0FDFA',
    hoverColor: 'rgba(13, 148, 136, 0.06)',
    borderRadius: '12px',
    borderRadiusSmall: '8px',
    boxShadow1: '0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)',
    boxShadow2: '0 4px 12px rgba(15, 23, 42, 0.08), 0 2px 4px rgba(15, 23, 42, 0.04)',
    boxShadow3: '0 8px 24px rgba(15, 23, 42, 0.10), 0 4px 8px rgba(15, 23, 42, 0.06)',
    dividerColor: '#E2E8F0',
    borderColor: '#E2E8F0',
    textColor1: '#134E4A',
    textColor2: '#3D6B67',
    textColor3: '#8BA8A3',
    placeholderColor: '#94A3B8',
    fontSize: '14px',
    fontSizeSmall: '13px',
    fontSizeMedium: '14px',
    fontSizeLarge: '16px',
    fontSizeMini: '12px',
    heightMini: '28px',
    heightSmall: '32px',
    heightMedium: '38px',
    heightLarge: '44px',
  },
  Button: {
    borderRadius: '10px',
    borderRadiusSmall: '8px',
    fontWeight: '600',
    colorHoverPrimary: '#14B8A6',
    textColorGhost: '#0D9488',
    textColorHoverGhost: '#14B8A6',
  },
  Card: {
    borderRadius: '16px',
    paddingMedium: '20px 24px',
    titleFontWeight: '700',
    titleFontSizeMedium: '16px',
    borderColor: '#E2E8F0',
    color: '#FFFFFF',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)',
  },
  Input: {
    borderRadius: '10px',
    color: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderHover: '1px solid #0D9488',
    borderFocus: '1px solid #0D9488',
    boxShadowFocus: '0 0 0 3px rgba(13, 148, 136, 0.12)',
  },
  Select: {
    borderRadius: '10px',
    menuBorderRadius: '12px',
  },
  DatePicker: {
    borderRadius: '10px',
  },
  TimePicker: {
    borderRadius: '10px',
  },
  InputNumber: {
    borderRadius: '10px',
  },
  Switch: {
    railColorActive: '#0D9488',
  },
  Tag: {
    borderRadius: '8px',
  },
  Menu: {
    borderRadius: '10px',
    itemHeight: '42px',
    arrowColor: '#94A3B8',
  },
  DataTable: {
    borderRadius: '12px',
    thColor: '#F8FAFC',
    thTextColor: '#134E4A',
    tdColor: '#FFFFFF',
    borderColor: '#E2E8F0',
  },
  Drawer: {
    borderRadius: '16px',
  },
  Slider: {
    fillColor: '#0D9488',
    fillColorHover: '#14B8A6',
  },
  Progress: {
    railColor: '#E2E8F0',
  },
  Tabs: {
    tabBorderColor: '#E2E8F0',
  },
  Modal: {
    borderRadius: '16px',
  },
  Message: {
    borderRadius: '10px',
  },
  Notification: {
    borderRadius: '12px',
  },
  Dialog: {
    borderRadius: '16px',
  },
  Badge: {
    color: '#EA580C',
  },
  Tooltip: {
    borderRadius: '8px',
  },
  Descriptions: {
    thColor: '#F8FAFC',
    tdColor: '#FFFFFF',
    borderColor: '#E2E8F0',
  },
}

const darkThemeOverrides: GlobalThemeOverrides = {
  common: {
    fontFamily: 'Plus Jakarta Sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontFamilyMono: 'JetBrains Mono, SF Mono, Consolas, monospace',
    primaryColor: '#14B8A6',
    primaryColorHover: '#2DD4BF',
    primaryColorPressed: '#0D9488',
    primaryColorSuppl: '#14B8A6',
    infoColor: '#14B8A6',
    infoColorHover: '#2DD4BF',
    infoColorPressed: '#0D9488',
    successColor: '#34D399',
    successColorHover: '#6EE7B7',
    successColorPressed: '#10B981',
    warningColor: '#F97316',
    warningColorHover: '#FB923C',
    warningColorPressed: '#EA580C',
    errorColor: '#EF4444',
    errorColorHover: '#F87171',
    errorColorPressed: '#DC2626',
    bodyColor: '#0F172A',
    cardColor: '#1E293B',
    modalColor: '#1E293B',
    popoverColor: '#1E293B',
    tableColor: '#1E293B',
    actionColor: '#0F172A',
    hoverColor: 'rgba(20, 184, 166, 0.1)',
    borderRadius: '12px',
    borderRadiusSmall: '8px',
    boxShadow1: '0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2)',
    boxShadow2: '0 4px 12px rgba(0, 0, 0, 0.4), 0 2px 4px rgba(0, 0, 0, 0.2)',
    boxShadow3: '0 8px 24px rgba(0, 0, 0, 0.5), 0 4px 8px rgba(0, 0, 0, 0.3)',
    dividerColor: '#334155',
    borderColor: '#334155',
    textColor1: '#F1F5F9',
    textColor2: '#CBD5E1',
    textColor3: '#64748B',
    placeholderColor: '#64748B',
    fontSize: '14px',
    fontSizeSmall: '13px',
    fontSizeMedium: '14px',
    fontSizeLarge: '16px',
    fontSizeMini: '12px',
    heightMini: '28px',
    heightSmall: '32px',
    heightMedium: '38px',
    heightLarge: '44px',
  },
  Button: {
    borderRadius: '10px',
    borderRadiusSmall: '8px',
    fontWeight: '600',
  },
  Card: {
    borderRadius: '16px',
    paddingMedium: '20px 24px',
    titleFontWeight: '700',
    titleFontSizeMedium: '16px',
    borderColor: '#334155',
    color: '#1E293B',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2)',
  },
  Input: {
    borderRadius: '10px',
    color: '#1E293B',
    border: '1px solid #334155',
    borderHover: '1px solid #14B8A6',
    borderFocus: '1px solid #14B8A6',
    boxShadowFocus: '0 0 0 3px rgba(20, 184, 166, 0.15)',
  },
  Select: {
    borderRadius: '10px',
    menuBorderRadius: '12px',
  },
  DatePicker: {
    borderRadius: '10px',
  },
  TimePicker: {
    borderRadius: '10px',
  },
  InputNumber: {
    borderRadius: '10px',
  },
  Switch: {
    railColorActive: '#14B8A6',
  },
  Tag: {
    borderRadius: '8px',
  },
  Menu: {
    borderRadius: '10px',
    itemHeight: '42px',
    arrowColor: '#64748B',
  },
  DataTable: {
    borderRadius: '12px',
    thColor: '#1E293B',
    thTextColor: '#F1F5F9',
    tdColor: '#1E293B',
    borderColor: '#334155',
  },
  Drawer: {
    borderRadius: '16px',
  },
  Slider: {
    fillColor: '#14B8A6',
    fillColorHover: '#2DD4BF',
  },
  Progress: {
    railColor: '#334155',
  },
  Tabs: {
    tabBorderColor: '#334155',
  },
  Modal: {
    borderRadius: '16px',
  },
  Message: {
    borderRadius: '10px',
  },
  Notification: {
    borderRadius: '12px',
  },
  Dialog: {
    borderRadius: '16px',
  },
  Badge: {
    color: '#F97316',
  },
  Tooltip: {
    borderRadius: '8px',
  },
  Descriptions: {
    thColor: '#1E293B',
    tdColor: '#1E293B',
    borderColor: '#334155',
  },
}

const ProviderWrapper = defineComponent({
  setup() {
    const pinia = createPinia()
    const themeStore = useThemeStore()

    const theme = computed(() => themeStore.isDark ? darkTheme : null)
    const themeOverrides = computed(() => themeStore.isDark ? darkThemeOverrides : lightThemeOverrides)

    return () => h(
      NConfigProvider,
      { theme: theme.value, themeOverrides: themeOverrides.value, locale: zhCN, dateLocale: dateZhCN },
      {
        default: () => h(NMessageProvider, null, {
          default: () => h(NDialogProvider, null, {
            default: () => h(NNotificationProvider, null, {
              default: () => h(App)
            })
          })
        })
      }
    )
  }
})

const app = createApp(ProviderWrapper)
app.use(createPinia())
app.use(router)
app.mount('#app')
