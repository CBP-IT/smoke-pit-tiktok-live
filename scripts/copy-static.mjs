// Copies the renderer's non-TypeScript files next to the compiled renderer.js.
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist/renderer', { recursive: true });
for (const file of ['index.html', 'styles.css']) copyFileSync(`src/renderer/${file}`, `dist/renderer/${file}`);
copyFileSync('build/icon.png', 'dist/renderer/icon.png');
