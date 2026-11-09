const fs = require('fs');
const path = require('path');

const assets = [
  'index.html',
  'manifest.json',
  'sw.js',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'live_state.json'
];

for (const dir of ['dist', 'public']) {
  fs.mkdirSync(path.join(__dirname, dir), { recursive: true });
  for (const file of assets) {
    const src = path.join(__dirname, file);
    const dest = path.join(__dirname, dir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  }
}

let projectJson = null;
try {
  projectJson = JSON.parse(fs.readFileSync(path.join(__dirname, '.vercel', 'project.json'), 'utf8'));
} catch (e) {
  projectJson = { error: e.message };
}

const diag = {
  builtAt: new Date().toISOString(),
  projectSettings: projectJson ? projectJson.settings : null,
  vercelEnv: process.env.VERCEL_ENV,
  vercelUrl: process.env.VERCEL_URL,
  vercelProdUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL
};

for (const dir of ['dist', 'public']) {
  fs.writeFileSync(path.join(__dirname, dir, 'status.json'), JSON.stringify(diag, null, 2));
}
console.log('PULSE static build completed successfully:', JSON.stringify(diag));
