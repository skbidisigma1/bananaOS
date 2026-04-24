import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        textEditor: resolve(__dirname, 'apps/text-editor/text-editor.html'),
        desktop: resolve(__dirname, 'desktop.html'),
        setup: resolve(__dirname, 'setup.html'),
        terminal: resolve(__dirname, 'apps/terminal/terminal.html'),
        files: resolve(__dirname, 'apps/files/files.html'),
        welcome: resolve(__dirname, 'apps/welcome/welcome.html')
      }
    }
  }
});