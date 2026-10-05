import { defineConfig, loadEnv } from "vite";
import { janePlugin } from "./vite/janePlugin.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [janePlugin(env.DEEPSEEK_API_KEY ?? "")],
    server: {
      watch: {
        ignored: ["**/tools/**"],
      },
    },
    optimizeDeps: {
      exclude: ["@dimforge/rapier3d-compat"],
    },
  };
});
