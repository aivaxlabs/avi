import type { ElectrobunConfig } from 'electrobun';
import packageMetadata from './package.json' with { type: 'json' };

export default {
  app: {
    name: 'Avi',
    identifier: 'net.aivax.avi',
    version: packageMetadata.version,
    description: packageMetadata.description,
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
      icon: 'assets/icon/avi.ico',
    },
    linux: {
      bundleCEF: false,
      defaultRenderer: 'native',
      icon: 'assets/icon/avi.png',
    },
  },
  scripts: {
    preBuild: 'scripts/build-renderer.mjs',
    postBuild: 'scripts/embed-windows-icons.mjs',
    postPackage: 'scripts/embed-windows-icons.mjs',
  },
  release: {
    generatePatch: false,
  },
} satisfies ElectrobunConfig;
