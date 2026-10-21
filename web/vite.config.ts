import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Mini App использует client-side роутинг (BrowserRouter), поэтому в dev отдаём
// index.html на любые пути (Vite делает это по умолчанию через historyApiFallback).
export default defineConfig(({ mode }) => ({
  base: loadEnv(mode, '.', '').VITE_BASE_PATH || (mode === 'production' ? '/shmotki/' : '/'),
  plugins: [react()],
  server: { port: 5173, host: true },
  preview: { port: 5173 },
}));
