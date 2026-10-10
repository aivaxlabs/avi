import { app } from 'electron';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const fail = (error) => {
    console.error(error);
    app.exit(1);
};

process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

const [target] = process.argv.splice(process.argv.findIndex((arg) => arg.endsWith('electron-test.mjs')) + 1, 1);

if (!target) {
    fail(new Error('Usage: electron scripts/electron-test.mjs <test-script>'));
} else {
    await import(pathToFileURL(resolve(target)).href).catch(fail);
}
