import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ใช้ './' เพื่อให้โฮสต์บน GitHub Pages ได้ทั้ง root domain และ subpath (/repo-name/) โดยไม่ต้องแก้ base ทุกครั้ง
export default defineConfig({
  plugins: [react()],
  base: './',
});
