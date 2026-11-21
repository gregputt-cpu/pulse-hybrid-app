const fs = require('fs');
const path = require('path');

let esbuild = null;
try {
  esbuild = require('esbuild');
} catch (e) {
  esbuild = null;
}

const rootDir = __dirname;
const outputDir = path.join(rootDir, '.vercel', 'output');
const staticDir = path.join(outputDir, 'static');
const distDir = path.join(rootDir, 'dist');
const publicDir = path.join(rootDir, 'public');

const backendStaticDir = path.join(rootDir, 'backend', 'static');
const targetDirs = [staticDir, distDir, publicDir, backendStaticDir];

for (const d of targetDirs) {
  fs.mkdirSync(d, { recursive: true });
  fs.rmSync(path.join(d, 'live_state.json'), { force: true });
  fs.rmSync(path.join(d, 'README.md'), { force: true });
  for (const sub of ['css', 'js']) {
    fs.rmSync(path.join(d, sub), { recursive: true, force: true });
  }
}

const assets = [
  'index.html',
  'manifest.json',
  'sw.js',
  'icon.svg',
  'icon-192.png',
  'icon-512.png'
];

const assetDirs = ['css', 'js'];

function copyOrMinifyFile(srcPath, destPath) {
  const ext = path.extname(srcPath).toLowerCase();
  if (esbuild && (ext === '.js' || ext === '.css')) {
    const raw = fs.readFileSync(srcPath, 'utf8');
    const result = esbuild.transformSync(raw, {
      loader: ext === '.js' ? 'js' : 'css',
      minify: true,
      target: ext === '.js' ? 'es2020' : undefined
    });
    fs.writeFileSync(destPath, result.code, 'utf8');
    return;
  }
  fs.copyFileSync(srcPath, destPath);
}

function copyDirRecursive(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyOrMinifyFile(srcPath, destPath);
    }
  }
}

for (const file of assets) {
  const src = path.join(rootDir, file);
  if (fs.existsSync(src)) {
    for (const d of targetDirs) {
      fs.copyFileSync(src, path.join(d, file));
    }
  }
}

for (const dir of assetDirs) {
  const srcDir = path.join(rootDir, dir);
  if (fs.existsSync(srcDir)) {
    for (const d of targetDirs) {
      copyDirRecursive(srcDir, path.join(d, dir));
    }
  }
}

const config = {
  version: 3,
  routes: [
    {
      src: '^/(?:index\\.html)?$',
      headers: {
        'Permissions-Policy': 'microphone=(self)'
      },
      continue: true
    },
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
