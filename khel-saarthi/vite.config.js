import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// If you deploy under a subpath (e.g. GitHub Pages repo "khel-saarthi"),
// set base: "/khel-saarthi/" and rebuild.
export default defineConfig({
  plugins: [react()],
  // base: "/khel-saarthi/",
});
