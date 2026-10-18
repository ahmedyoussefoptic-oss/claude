#!/usr/bin/env node
// Builds a clean, school-neutral copy of the system for another school:
//   node setup/make-package.mjs <output-dir>
// Takes the committed code (git HEAD), leaves out the old PHP version, the
// agent notes and this school's settings, removes the original Firebase
// project from the code defaults (so a copy can never write to it by
// mistake), and adds the setup guide. The receiving school then follows
// setup/دليل_التثبيت.md (configure.mjs → build → deploy).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(ROOT, '..', 'school-crm-package'));
if (fs.existsSync(out)) fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// Committed files only (no node_modules, dist, uploads, local data).
const tar = execFileSync('git', ['archive', '--format=tar', 'HEAD'], { cwd: ROOT, maxBuffer: 1 << 30 });
execFileSync('tar', ['-x', '-C', out], { input: tar });

const drop = [
  '.agents', '.claude', '.DS_Store', 'docs', 'lib', 'assets', 'uploads', 'data', '.htaccess', 'skills-lock.json',
  'api.php', 'config.php', 'cron.php', 'index.php', 'install.php', 'login.php', 'logout.php', 'track.php',
  'complaints-system.md', 'complaints-system-technical-spec.md', 'README.md', 'دليل_التثبيت.md',
  'setup/make-package.mjs',
];
for (const p of drop) fs.rmSync(path.join(out, p), { recursive: true, force: true });

// No default project: the copy only runs once configure.mjs wrote .env.local.
const edit = (file, fn) => { const p = path.join(out, file); fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8'))); };
edit('src/config/firebase.js', (s) => s
  .replace(/(env\.VITE_FIREBASE_[A-Z_]+ \|\| )"[^"]*"/g, '$1""')
  .replace('export const app = initializeApp(firebaseConfig);', `if (!firebaseConfig.projectId) {
  throw new Error("النظام غير مُهيّأ: شغّل node setup/configure.mjs school.config.json ثم npm run build");
}
export const app = initializeApp(firebaseConfig);`));
edit('src/utils/push.js', (s) => s.replace(/(VITE_FIREBASE_VAPID_KEY \|\| )'[^']*'/, "$1''"));
edit('public/firebase-messaging-sw.js', (s) => s.replace(/(swParams\.get\('[a-zA-Z]+'\) \|\| )"[^"]*"/g, '$1""'));
edit('functions/index.js', (s) => s.replace('process.env.PUBLIC_APP_URL || "https://mis-complaints.web.app"', 'process.env.PUBLIC_APP_URL || ""'));
fs.writeFileSync(path.join(out, '.firebaserc'), `${JSON.stringify({ projects: { default: 'YOUR_PROJECT_ID' } }, null, 2)}\n`);
fs.writeFileSync(path.join(out, 'functions/.env'), '# Written by setup/configure.mjs\nENABLE_WA_API=false\nSYSTEM_OWNER_EMAIL=\nPUBLIC_APP_URL=\nSCHOOL_NAME=\n');

fs.writeFileSync(path.join(out, 'school.config.example.json'), fs.readFileSync(path.join(ROOT, 'setup/school.config.example.json')));
fs.writeFileSync(path.join(out, 'README.md'), '# نظام علاقات العملاء (CRM) — نسخة للتثبيت\n\nابدأ من **setup/دليل_التثبيت.md**.\n\n```bash\nnpm install && (cd functions && npm install)\ncp school.config.example.json school.config.json   # عدّل القيم وضع الشعار\nnode setup/configure.mjs school.config.json\nnpx firebase-tools use <Project ID>\nnpm run build && npx firebase-tools deploy\n```\n');
console.log(`✔ Package written to ${out}`);
