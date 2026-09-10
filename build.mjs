/* 產生乾淨的部署資料夾 dist/：只放要上線的東西，
   避開 node_modules、test*.js 等被一起上傳。
   用法： node build.mjs   （或 npm run build） */
import { rmSync, mkdirSync, copyFileSync, cpSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

// 首頁要叫 index.html（Cloudflare Pages 預設首頁）
copyFileSync('ielts.html', 'dist/index.html');

// 後端 API：dist/functions/ 會被 Pages 編譯成 Functions
cpSync('functions', 'dist/functions', { recursive: true });

console.log('已建置 dist/（index.html + functions/），可以部署了');
