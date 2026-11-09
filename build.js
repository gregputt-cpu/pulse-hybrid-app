const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const outputDir = path.join(rootDir, '.vercel', 'output');
const staticDir = path.join(outputDir, 'static');
const distDir = path.join(rootDir, 'dist');
const publicDir = path.join(rootDir, 'public');

for (const d of [staticDir, distDir, publicDir]) {
  fs.mkdirSync(d, { recursive: true });
}

const assets = [
  'index.html',
  'manifest.json',
  'sw.js',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'live_state.json',
  'README.md'
];

for (const file of assets) {
  const src = path.join(rootDir, file);
  if (fs.existsSync(src)) {
    for (const d of [staticDir, distDir, publicDir]) {
      fs.copyFileSync(src, path.join(d, file));
    }
  }
}

const config = {
  version: 3,
  routes: [
    {
      handle: 'filesystem'
    },
    {
      src: '/api/(.*)',
      dest: 'https://pulse-backend.up.railway.app/api/$1'
    },
    {
      src: '/((?!.*\\.).*)',
      dest: '/index.html'
    }
  ],
  overrides: {
    'manifest.json': {
      contentType: 'application/manifest+json'
    },
    'sw.js': {
      contentType: 'application/javascript'
    }
  }
};

fs.writeFileSync(path.join(outputDir, 'config.json'), JSON.stringify(config, null, 2));
console.log('Build Output API v3 generated successfully at .vercel/output');
