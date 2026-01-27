import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    host: "0.0.0.0",
    port: 5175,
    allowedHosts: ["query.yiyongai.cn"],
    proxy: {
      "/api": {
        target: "https://cloud.yiyongai.cn",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
