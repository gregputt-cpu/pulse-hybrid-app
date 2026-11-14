const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const outputDir = path.join(rootDir, '.vercel', 'output');
const staticDir = path.join(outputDir, 'static');
const distDir = path.join(rootDir, 'dist');
const publicDir = path.join(rootDir, 'public');

const backendStaticDir = path.join(rootDir, 'backend', 'static');

for (const d of [staticDir, distDir, publicDir, backendStaticDir]) {
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

const assetDirs = ['css', 'js'];

function copyDirRecursive(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

for (const file of assets) {
  const src = path.join(rootDir, file);
  if (fs.existsSync(src)) {
    for (const d of [staticDir, distDir, publicDir, backendStaticDir]) {
      fs.copyFileSync(src, path.join(d, file));
    }
    if (file === 'live_state.json') {
      const backendDir = path.join(rootDir, 'backend');
      if (fs.existsSync(backendDir)) {
        fs.copyFileSync(src, path.join(backendDir, file));
      }
    }
  }
}

for (const dir of assetDirs) {
  const srcDir = path.join(rootDir, dir);
  if (fs.existsSync(srcDir)) {
    for (const d of [staticDir, distDir, publicDir, backendStaticDir]) {
      copyDirRecursive(srcDir, path.join(d, dir));
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
      dest: 'https://pulse-hybrid-app-production.up.railway.app/api/$1'
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
