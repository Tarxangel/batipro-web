import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        map: resolve(__dirname, 'map.html')
      }
    }
  },
  server: {
    host: '0.0.0.0',  // Écoute sur toutes les interfaces (nécessaire pour tunnel VS Code)
    port: 5173,
    open: false  // Désactiver l'ouverture auto car on utilise le tunnel
  }
})
