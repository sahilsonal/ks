import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'

// https dev-server + LAN expose
export default defineConfig({
  plugins: [react(), mkcert()],
  server: {
    https: true,   // camera access https
    host: true,    // same network devices (mobile) access via lan
    port: 5173     // default port
  }
})
