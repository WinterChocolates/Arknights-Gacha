// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: false },

  modules: ["@nuxt/ui", "nuxt-echarts"],

  css: ["~/assets/css/main.css"],

  // 纯本地工具，没有 SEO 需求：SPA 模式，构建产物是一堆静态文件，由 Tauri 的 WebView 直接加载
  ssr: false,

  app: {
    head: {
      title: "明日方舟寻访记录",
      htmlAttrs: { lang: "zh-CN" },
      meta: [
        { charset: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { name: "color-scheme", content: "light" },
      ],
    },
  },

  colorMode: {
    // 纯白浅色主题：日间阅读更清爽，与 endfield-gacha 的亮色配色一致
    preference: "light",
    fallback: "light",
    classSuffix: "",
    // 禁用持久化：storageKey 传 false 会让 color-mode 的读写直接失败，
    // 避免 WebView 里残留的旧值（dark/system）覆盖强制浅色。
    // 模块类型没开放 false，只能显式断言。
    storageKey: false as unknown as string,
  },

  imports: {
    dirs: ["~/composables"],
  },

  ui: {
    fonts: false,
  },

  echarts: {
    renderer: ["svg"],
    charts: ["PieChart", "BarChart", "LineChart"],
    components: ["TooltipComponent", "LegendComponent", "GridComponent", "TitleComponent"],
  },

  typescript: {
    typeCheck: false,
  },

  runtimeConfig: {
    public: {
      // 数据接口基地址，留空表示与页面同源
      apiBase: "",
    },
  },

  vite: {
    clearScreen: false,
    envPrefix: ["VITE_", "TAURI_"],
    server: {
      strictPort: true,
    },
  },

  devServer: {
    // Tauri 在移动端调试时会设置 TAURI_DEV_HOST
    host: process.env.TAURI_DEV_HOST || "127.0.0.1",
    port: Number(process.env.PORT || 3000),
  },
});
