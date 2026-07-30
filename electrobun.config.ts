import type { ElectrobunConfig } from 'electrobun';

export default {
  app: {
    name: 'AIVAX',
    identifier: 'net.aivax.chat',
    version: '0.1.0',
    description: 'Local desktop client for AI conversations and tools.',
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: 'src/main/main.js',
      minify: true,
      naming: 'index.js',
    },
    copy: {
      'dist/index.html': 'views/mainview/index.html',
      'dist/assets': 'views/mainview/assets',
    },
    buildFolder: 'build',
    artifactFolder: 'release',
    targets: 'current',
    locales: ['en', 'pt'],
    watch: [
      'index.html',
      'src/renderer',
      'src/styles',
      'vite.config.js',
    ],
    mac: {
      bundleCEF: false,
      defaultRenderer: 'native',
    },
    win: {
      bundleCEF: false,
      defaultRenderer: 'native',
      icon: 'assets/icon/aivchat.ico',
    },
    linux: {
      bundleCEF: false,
      defaultRenderer: 'native',
      icon: 'assets/icon/aivchat.png',
    },
  },
  scripts: {
    preBuild: 'scripts/build-renderer.mjs',
  },
  release: {
    generatePatch: false,
  },
} satisfies ElectrobunConfig;
