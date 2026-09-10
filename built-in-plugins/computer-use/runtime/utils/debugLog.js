import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const defaultDebugLogPath = 'debug.log';
let mediaCounter = 0;
let debugWriteFailures = 0;
const defaultRunId = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${process.pid}`;
export function isDebugEnabled() {
    return process.env.COMPUTER_USE_DEBUG_ENABLED === '1';
}
export function debugLog(component, event, data) {
    if (!isDebugEnabled()) {
        return;
    }
    try {
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
        const payload = data ? ` Data=${JSON.stringify(data)}` : '';
        const line = `[${timestamp}] [DEBUG] Component="${component}" Event="${event}"${payload}\n`;
        const logPath = resolve(process.env.COMPUTER_USE_DEBUG_LOG_PATH || defaultDebugLogPath);
        mkdirSync(dirname(logPath), { recursive: true });
        appendFileSync(logPath, line, 'utf8');
    }
    catch {
        debugWriteFailures += 1;
    }
}
export function getDebugRunId() {
    return process.env.COMPUTER_USE_DEBUG_RUN_ID || defaultRunId;
}
export function getDebugMediaDir() {
    return resolve(process.env.COMPUTER_USE_DEBUG_MEDIA_DIR || join(tmpdir(), 'computer-use-mcp-debug', getDebugRunId()));
}
export function getDebugWriteFailureCount() {
    return debugWriteFailures;
}
export function saveDebugMedia(kind, data, extension = 'png', metadata) {
    if (!isDebugEnabled()) {
        return undefined;
    }
    try {
        const mediaDir = getDebugMediaDir();
        mkdirSync(mediaDir, { recursive: true });
        mediaCounter += 1;
        const safeKind = kind.replaceAll(/[^a-z0-9_-]/gi, '-').toLowerCase();
        const filePath = join(mediaDir, `${process.pid}-${String(mediaCounter).padStart(4, '0')}-${safeKind}.${extension}`);
        writeFileSync(filePath, data);
        debugLog('media', 'saved', {
            kind,
            file_path: filePath,
            bytes: data.length,
            ...metadata,
        });
        return filePath;
    }
    catch {
        return undefined;
    }
}
