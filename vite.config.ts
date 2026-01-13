import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: true
  },
  server: {
    host: '0.0.0.0',  // Écoute sur toutes les interfaces (nécessaire pour tunnel VS Code)
    port: 5173,
    open: false  // Désactiver l'ouverture auto car on utilise le tunnel
  }
})
