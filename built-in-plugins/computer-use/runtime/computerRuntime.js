import { Button, keyboard, mouse, Point, } from '@nut-tree-fork/nut-js';
import { spawn, execFile, execFileSync, } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { toKeys } from './xdotoolStringToKeys.js';
import { debugLog, getDebugRunId, saveDebugMedia } from './utils/debugLog.js';
const execFileAsync = promisify(execFile);
const maxLongEdge = 1568;
const maxPixels = 1.15 * 1024 * 1024;
const pauseMs = 5000;
const inputIgnoreMs = 750;
const previewDelayMs = 500;
const actionDelayMs = 250;
const maxVisibleApplicationsPerMonitor = 12;
const minVisibleApplicationCoverage = 0.05;
const enumerateVisibleWindows = async () => {
    debugLog('window-enumerator', 'start', {
        platform: process.platform,
    });
    const { openWindows } = await import('get-windows');
    const windows = await openWindows({
        accessibilityPermission: false,
        screenRecordingPermission: process.platform !== 'darwin',
    });
    const mappedWindows = windows
        .map((window) => ({
        id: window.id,
        name: window.owner.name.trim(),
        pid: window.owner.processId,
        title: window.title.trim(),
        bounds: {
            x: Math.round(window.bounds.x),
            y: Math.round(window.bounds.y),
            width: Math.round(window.bounds.width),
            height: Math.round(window.bounds.height),
        },
    }))
        .filter((window) => window.name && window.bounds.width > 0 && window.bounds.height > 0)
        .filter((window) => window.title || window.name.toLowerCase() !== 'electron');
    debugLog('window-enumerator', 'complete', {
        raw_count: windows.length,
        filtered_count: mappedWindows.length,
        windows: mappedWindows,
    });
    return mappedWindows;
};
const focusWindow = async (input) => {
    const name = input.name?.trim();
    if (input.pid === undefined && !name) {
        throw new Error('focus_window requires pid or name');
    }
    debugLog('window-focus', 'start', { platform: process.platform, pid: input.pid, name });
    if (process.platform === 'win32') {
        const script = `
$pidFilter = if ($env:COMPUTER_USE_FOCUS_PID) { [int]$env:COMPUTER_USE_FOCUS_PID } else { $null }
$nameFilter = $env:COMPUTER_USE_FOCUS_NAME
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Win32Focus {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$found = $null
[Win32Focus]::EnumWindows({
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    if (-not [Win32Focus]::IsWindowVisible($hWnd)) { return $true }
    $builder = [Text.StringBuilder]::new(1024)
    [void][Win32Focus]::GetWindowText($hWnd, $builder, $builder.Capacity)
    $title = $builder.ToString()
    if ([string]::IsNullOrWhiteSpace($title)) { return $true }
    [uint32]$windowPid = 0
    [void][Win32Focus]::GetWindowThreadProcessId($hWnd, [ref]$windowPid)
    $processName = ""
    try { $processName = (Get-Process -Id $windowPid -ErrorAction Stop).ProcessName } catch {}
    $pidMatches = $pidFilter -ne $null -and [int]$windowPid -eq $pidFilter
    $nameMatches = -not [string]::IsNullOrWhiteSpace($nameFilter) -and ($title.IndexOf($nameFilter, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or $processName.IndexOf($nameFilter, [StringComparison]::OrdinalIgnoreCase) -ge 0)
    if ($pidMatches -or $nameMatches) {
        $script:found = [pscustomobject]@{ hwnd = $hWnd.ToInt64(); pid = [int]$windowPid; title = $title; name = $processName }
        [void][Win32Focus]::ShowWindowAsync($hWnd, 9)
        [void][Win32Focus]::SetForegroundWindow($hWnd)
        return $false
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
if ($found -eq $null) { throw "No matching window found." }
$found | ConvertTo-Json -Compress
`;
        const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
            env: {
                ...process.env,
                COMPUTER_USE_FOCUS_PID: input.pid === undefined ? '' : String(input.pid),
                COMPUTER_USE_FOCUS_NAME: name ?? '',
            },
            windowsHide: true,
        });
        return JSON.parse(String(stdout));
    }
    if (process.platform === 'darwin') {
        const appleScript = input.pid === undefined
            ? 'tell application "System Events" to set frontmost of first process whose name contains item 1 of argv to true'
            : 'tell application "System Events" to set frontmost of first process whose unix id is (item 1 of argv as integer) to true';
        await execFileAsync('osascript', ['-e', appleScript, input.pid === undefined ? name : String(input.pid)]);
        return { pid: input.pid ?? null, name: name ?? null };
    }
    if (process.platform === 'linux' && hasXdotool()) {
        const searchArgs = input.pid === undefined ? ['search', '--name', name] : ['search', '--pid', String(input.pid)];
        const { stdout } = await execFileAsync('xdotool', searchArgs);
        const windowId = String(stdout).trim().split(/\s+/)[0];
        if (!windowId) {
            throw new Error('No matching window found.');
        }
        await execFileAsync('xdotool', ['windowactivate', windowId]);
        return { window_id: windowId, pid: input.pid ?? null, name: name ?? null };
    }
    throw new Error(`focus_window is not supported on ${process.platform}`);
};
mouse.config.autoDelayMs = 100;
mouse.config.mouseSpeed = 1000;
keyboard.config.autoDelayMs = 10;
function getSizeToApiScale(width, height) {
    const longEdgeScale = Math.max(width, height) > maxLongEdge ? maxLongEdge / Math.max(width, height) : 1;
    const pixelScale = width * height > maxPixels ? Math.sqrt(maxPixels / (width * height)) : 1;
    return Math.min(longEdgeScale, pixelScale);
}
function toMonitor(display) {
    return {
        monitor_id: display.id,
        index: display.index ?? 0,
        name: display.name,
        x: display.x,
        y: display.y,
        width: display.width,
        height: display.height,
        scale_factor: display.scale_factor,
        is_primary: display.is_primary,
        visible_applications: [],
    };
}
function now() {
    return Date.now();
}
export function localToGlobal(monitor, coordinate, imageSize) {
    if (coordinate[0] < 0 || coordinate[1] < 0 || coordinate[0] >= imageSize.width || coordinate[1] >= imageSize.height) {
        throw new Error(`Coordinate (${coordinate[0]}, ${coordinate[1]}) is outside monitor ${monitor.monitor_id} coordinate space of ${imageSize.width}x${imageSize.height}`);
    }
    const localX = Math.round(coordinate[0] * (monitor.width / imageSize.width));
    const localY = Math.round(coordinate[1] * (monitor.height / imageSize.height));
    return {
        x: monitor.x + localX,
        y: monitor.y + localY,
        local_x: localX,
        local_y: localY,
    };
}
export class ElectronComputerDriver {
    child;
    buffer = '';
    ready;
    readyResolve;
    readyReject;
    port;
    escapeCallback;
    displaysChangedCallback;
    onEscape(callback) {
        this.escapeCallback = callback;
    }
    onDisplaysChanged(callback) {
        this.displaysChangedCallback = callback;
    }
    async listDisplays() {
        debugLog('electron-driver', 'list-displays');
        const result = await this.request('displays');
        const displays = result.displays ?? [];
        debugLog('electron-driver', 'list-displays-result', { displays });
        return displays;
    }
    async showOverlay() {
        debugLog('electron-driver', 'show-overlay');
        const result = await this.request('show');
        const displays = result.displays ?? [];
        debugLog('electron-driver', 'show-overlay-result', { displays });
        return displays;
    }
    async hideOverlay() {
        debugLog('electron-driver', 'hide-overlay');
        await this.request('hide');
    }
    async setOverlayStatus(status, text) {
        debugLog('electron-driver', 'set-overlay-status', { status, text });
        await this.request('status', { status, text });
    }
    async flash(monitorId, x, y) {
        debugLog('electron-driver', 'flash', { monitor_id: monitorId, x, y });
        await this.request('flash', { displayId: monitorId, x, y });
    }
    async screenshot(monitorId) {
        debugLog('electron-driver', 'screenshot-request', { monitor_id: monitorId });
        const result = await this.request('screenshot', { displayId: monitorId });
        const screenshot = {
            data: Buffer.from(String(result.data), 'base64'),
            width: Number(result.width),
            height: Number(result.height),
        };
        debugLog('electron-driver', 'screenshot-result', {
            monitor_id: monitorId,
            width: screenshot.width,
            height: screenshot.height,
            bytes: screenshot.data.length,
        });
        return screenshot;
    }
    async dispose() {
        if (!this.child) {
            return;
        }
        try {
            debugLog('electron-driver', 'dispose');
            await this.request('shutdown', undefined, 1000);
        }
        catch {
            debugLog('electron-driver', 'dispose-kill-child');
            this.child.kill();
        }
    }
    async request(method, params, timeoutMs = 30_000) {
        await this.ensureStarted();
        if (!this.port) {
            throw new Error('Overlay process did not publish an HTTP port');
        }
        const startedAt = now();
        debugLog('electron-driver', 'rpc-request', { method, params, timeout_ms: timeoutMs });
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
        }, timeoutMs);
        try {
            const response = await fetch(`http://127.0.0.1:${this.port}/rpc`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ method, params }),
                signal: controller.signal,
            });
            const payload = await response.json();
            if (!response.ok || payload.error) {
                debugLog('electron-driver', 'rpc-error', {
                    method,
                    status: response.status,
                    error: payload.error,
                    elapsed_ms: now() - startedAt,
                });
                throw new Error(payload.error ?? `Overlay request failed: ${method}`);
            }
            debugLog('electron-driver', 'rpc-result', {
                method,
                elapsed_ms: now() - startedAt,
                result_keys: Object.keys(payload.result ?? {}),
            });
            return payload.result ?? {};
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async ensureStarted() {
        if (this.child) {
            await this.ready;
            return;
        }
        const electronRoot = new URL('../node_modules/electron/dist/', import.meta.url);
        const electronPath = fileURLToPath(new URL(process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron', electronRoot));
        const overlayPath = fileURLToPath(new URL('./overlayProcess.cjs', import.meta.url));
        debugLog('electron-driver', 'spawn-overlay', {
            electron_path: electronPath,
            overlay_path: overlayPath,
            debug_run_id: getDebugRunId(),
        });
        const childEnv = {
            ...process.env,
            COMPUTER_USE_DEBUG_RUN_ID: getDebugRunId(),
        };
        delete childEnv.ELECTRON_RUN_AS_NODE;
        const child = spawn(electronPath, [overlayPath], {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            env: childEnv,
        });
        this.child = child;
        this.ready = new Promise((resolve, reject) => {
            this.readyResolve = resolve;
            this.readyReject = reject;
        });
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (chunk) => {
            this.readStdout(chunk);
        });
        child.stderr?.on('data', (chunk) => {
            debugLog('electron-driver', 'overlay-stderr', { text: String(chunk) });
            process.stderr.write(String(chunk));
        });
        child.on('exit', () => {
            debugLog('electron-driver', 'overlay-exit');
            const error = new Error('Overlay process exited');
            this.port = undefined;
            this.child = undefined;
            this.readyReject?.(error);
        });
        await this.ready;
    }
    readStdout(chunk) {
        this.buffer += chunk;
        let newlineIndex = this.buffer.indexOf('\n');
        while (newlineIndex >= 0) {
            const line = this.buffer.slice(0, newlineIndex).trim();
            this.buffer = this.buffer.slice(newlineIndex + 1);
            if (line) {
                this.handleMessage(line);
            }
            newlineIndex = this.buffer.indexOf('\n');
        }
    }
    handleMessage(line) {
        const message = JSON.parse(line);
        debugLog('electron-driver', 'overlay-message', { message });
        if (message.event) {
            if (message.event === 'ready') {
                this.port = message.port;
                this.readyResolve?.();
            }
            else if (message.event === 'escape') {
                this.escapeCallback?.();
            }
            else if (message.event === 'displays_changed') {
                this.displaysChangedCallback?.();
            }
            else if (message.event === 'error') {
                this.readyReject?.(new Error(message.error ?? 'Overlay process error'));
            }
        }
    }
}
export class UserInputMonitor {
    hook;
    inputCallback;
    escapeCallback;
    started = false;
    async start(inputCallback, escapeCallback) {
        if (this.started) {
            return;
        }
        this.hook = await import('uiohook-napi');
        this.inputCallback = inputCallback;
        this.escapeCallback = escapeCallback;
        this.hook.uIOhook.on('input', this.handleInput);
        this.hook.uIOhook.start();
        this.started = true;
    }
    stop() {
        if (!this.started || !this.hook) {
            return;
        }
        this.hook.uIOhook.removeListener('input', this.handleInput);
        this.hook.uIOhook.stop();
        this.started = false;
    }
    handleInput = (event) => {
        if (event.keycode === this.hook?.UiohookKey.Escape) {
            this.escapeCallback?.();
            return;
        }
        this.inputCallback?.();
    };
}
export class ActionQueue {
    tail = Promise.resolve();
    async enqueue(callback) {
        const run = this.tail.then(callback, callback);
        this.tail = run.then(() => undefined, () => undefined);
        return run;
    }
}
export class ComputerSessionManager {
    driver;
    inputMonitor;
    windowEnumerator;
    windowFocuser;
    session;
    imageSizes = new Map();
    queue = new ActionQueue();
    pauseUntil = 0;
    ignoreInputUntil = 0;
    agentInputDepth = 0;
    pauseTimer;
    endedSession;
    constructor(driver = new ElectronComputerDriver(), inputMonitor = new UserInputMonitor(), windowEnumerator = enumerateVisibleWindows, windowFocuser = focusWindow) {
        this.driver = driver;
        this.inputMonitor = inputMonitor;
        this.windowEnumerator = windowEnumerator;
        this.windowFocuser = windowFocuser;
        this.driver.onEscape(() => {
            this.handleEscapeInput();
        });
        this.driver.onDisplaysChanged(() => {
            void this.refreshDisplays();
        });
    }
    async listMonitors() {
        return this.snapshotMonitors(await this.driver.listDisplays());
    }
    async getContext() {
        const monitors = await this.listMonitors();
        const cursorPosition = await mouse.getPosition();
        const monitor = monitors.find((candidate) => cursorPosition.x >= candidate.x && cursorPosition.x < candidate.x + candidate.width && cursorPosition.y >= candidate.y && cursorPosition.y < candidate.y + candidate.height);
        const context = {
            ok: true,
            system: {
                date_time: new Date().toISOString(),
                timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
                platform: process.platform,
            },
            cursor: {
                global_x: cursorPosition.x,
                global_y: cursorPosition.y,
                monitor_id: monitor?.monitor_id ?? null,
                x: monitor ? cursorPosition.x - monitor.x : cursorPosition.x,
                y: monitor ? cursorPosition.y - monitor.y : cursorPosition.y,
            },
            monitors: monitors.map((candidate) => ({
                index: candidate.index,
                monitor_id: candidate.monitor_id,
                bounds: {
                    x: candidate.x,
                    y: candidate.y,
                    width: candidate.width,
                    height: candidate.height,
                },
                windows: candidate.visible_applications.map((window) => ({
                    name: window.name,
                    pid: window.pid,
                    title: window.title,
                    bounds: window.bounds,
                })),
                windows_error: candidate.visible_applications_error,
            })),
        };
        debugLog('context', 'complete', context);
        return this.result(context);
    }
    async focusWindow(input) {
        const focused = await this.windowFocuser(input);
        return this.result({
            ok: true,
            focused,
        });
    }
    async toggleSession(input) {
        debugLog('session-manager', 'toggle-session', { action: input.action, session_id: input.session_id });
        if (input.action === 'start') {
            return this.startSession();
        }
        return this.endSession(input.session_id, 'agent');
    }
    async use(input) {
        debugLog('session-manager', 'use-enqueue', {
            session_id: input.session_id,
            action_count: input.actions.length,
            actions: input.actions,
        });
        return this.queue.enqueue(async () => {
            const startedAt = now();
            debugLog('session-manager', 'use-start', {
                session_id: input.session_id,
                action_count: input.actions.length,
            });
            const validation = this.validateActiveSession(input.session_id);
            if (!validation.ok) {
                debugLog('session-manager', 'use-validation-failed', validation);
                return this.result(validation);
            }
            try {
                await this.waitForUnpaused();
                if (!this.session) {
                    debugLog('session-manager', 'use-session-ended-during-wait', { session_id: input.session_id });
                    return this.result(this.endedResult(input.session_id));
                }
                const result = await this.executeSequence(input);
                debugLog('session-manager', 'use-complete', {
                    session_id: input.session_id,
                    action_count: input.actions.length,
                    elapsed_ms: now() - startedAt,
                    content_types: result.content.map((item) => item.type),
                    structured_keys: Object.keys(result.structuredContent),
                });
                return result;
            }
            catch (error) {
                debugLog('session-manager', 'use-error', {
                    session_id: input.session_id,
                    action_count: input.actions.length,
                    error: error instanceof Error ? error.message : String(error),
                    elapsed_ms: now() - startedAt,
                });
                return this.result({
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                    session_id: input.session_id,
                });
            }
        });
    }
    async dispose() {
        debugLog('session-manager', 'dispose');
        this.inputMonitor.stop();
        await this.driver.dispose();
    }
    async startSession() {
        if (this.session) {
            debugLog('session-manager', 'start-session-already-active', {
                session_id: this.session.session_id,
            });
            return this.result({
                ok: true,
                status: 'already_active',
                session: this.session,
                monitors: this.session.monitors,
            });
        }
        debugLog('session-manager', 'start-session-begin');
        const monitors = await this.snapshotMonitors(await this.driver.showOverlay());
        const session = {
            session_id: randomUUID(),
            started_at: new Date().toISOString(),
            status: 'active',
            monitors,
            input_monitor: 'active',
        };
        this.session = session;
        this.endedSession = undefined;
        try {
            await this.inputMonitor.start(() => {
                this.recordManualInput();
            }, () => {
                this.handleEscapeInput();
            });
        }
        catch (error) {
            session.input_monitor = 'unavailable';
            session.input_monitor_error = error instanceof Error ? error.message : String(error);
            debugLog('session-manager', 'input-monitor-unavailable', {
                error: session.input_monitor_error,
            });
        }
        await this.driver.setOverlayStatus('active', 'Agent is using your computer');
        debugLog('session-manager', 'start-session-complete', {
            session_id: session.session_id,
            monitors,
            input_monitor: session.input_monitor,
            input_monitor_error: session.input_monitor_error,
        });
        return this.result({
            ok: true,
            status: 'started',
            session,
            monitors,
        });
    }
    async endSession(sessionId, endedBy) {
        if (!this.session) {
            debugLog('session-manager', 'end-session-inactive', { session_id: sessionId, ended_by: endedBy });
            return this.result(this.endedResult(sessionId));
        }
        if (!sessionId || sessionId !== this.session.session_id) {
            debugLog('session-manager', 'end-session-invalid', {
                requested_session_id: sessionId,
                active_session_id: this.session.session_id,
            });
            return this.result({
                ok: false,
                status: 'invalid_session',
                error: 'The active session_id is required to end computer control.',
            });
        }
        const ended = {
            session_id: this.session.session_id,
            ended_by: endedBy,
            ended_at: new Date().toISOString(),
        };
        this.endedSession = ended;
        this.session = undefined;
        this.imageSizes.clear();
        this.inputMonitor.stop();
        await this.driver.hideOverlay();
        debugLog('session-manager', 'end-session-complete', ended);
        return this.result({
            ok: true,
            status: 'ended',
            session: ended,
        });
    }
    async endByUserEscape() {
        if (!this.session) {
            debugLog('session-manager', 'escape-without-session');
            return;
        }
        const sessionId = this.session.session_id;
        this.session = undefined;
        this.imageSizes.clear();
        this.inputMonitor.stop();
        this.endedSession = {
            session_id: sessionId,
            ended_by: 'user_escape',
            ended_at: new Date().toISOString(),
        };
        await this.driver.hideOverlay();
        debugLog('session-manager', 'end-by-user-escape', this.endedSession);
    }
    validateActiveSession(sessionId) {
        if (!this.session) {
            return this.endedResult(sessionId);
        }
        if (!sessionId || sessionId !== this.session.session_id) {
            return {
                ok: false,
                status: 'invalid_session',
                error: 'computer_use requires the active session_id from computer_toggle_session.',
            };
        }
        return { ok: true };
    }
    endedResult(sessionId) {
        if (this.endedSession && (!sessionId || sessionId === this.endedSession.session_id)) {
            return {
                ok: false,
                status: 'ended',
                session: this.endedSession,
            };
        }
        return {
            ok: false,
            status: 'inactive',
            error: 'No active computer control session. Call computer_toggle_session with action=start first.',
        };
    }
    async executeSequence(input) {
        if (input.actions.length === 0) {
            throw new Error('computer_use requires at least one action in actions');
        }
        const steps = [];
        const content = [];
        let finalPreviewTarget;
        let previewFromCursor = false;
        for (const [index, actionInput] of input.actions.entries()) {
            // eslint-disable-next-line no-await-in-loop
            await this.waitForUnpaused();
            if (!this.session) {
                return this.result(this.endedResult(input.session_id));
            }
            const stepStartedAt = now();
            debugLog('sequence', 'step-start', {
                session_id: input.session_id,
                index,
                action: actionInput,
            });
            // eslint-disable-next-line no-await-in-loop
            const execution = await this.executeAction(input.session_id, actionInput);
            steps.push({
                index,
                elapsed_ms: now() - stepStartedAt,
                ...execution.data,
            });
            if (execution.content) {
                content.push(...execution.content);
            }
            if (execution.previewTarget) {
                finalPreviewTarget = execution.previewTarget;
                previewFromCursor = false;
            }
            else if (execution.previewFromCursor) {
                finalPreviewTarget = undefined;
                previewFromCursor = true;
            }
            debugLog('sequence', 'step-complete', {
                session_id: input.session_id,
                index,
                action: actionInput.action,
                elapsed_ms: now() - stepStartedAt,
            });
            if (index < input.actions.length - 1) {
                debugLog('sequence', 'implicit-delay', {
                    session_id: input.session_id,
                    after_index: index,
                    delay_ms: actionDelayMs,
                });
                // eslint-disable-next-line no-await-in-loop
                await delay(actionDelayMs);
            }
        }
        const structuredContent = {
            ok: true,
            session_id: input.session_id,
            action_count: input.actions.length,
            delay_between_actions_ms: actionDelayMs,
            steps,
        };
        if (finalPreviewTarget || previewFromCursor) {
            try {
                const previewTarget = finalPreviewTarget ?? await this.targetFromCursor();
                debugLog('preview', 'wait-before-capture', {
                    delay_ms: previewDelayMs,
                    target: previewTarget,
                });
                await delay(previewDelayMs);
                const preview = await this.capturePreview(previewTarget);
                const debugMediaPath = saveDebugMedia('mcp-interaction-preview-response', preview.data, 'png', {
                    ...preview.metadata,
                });
                structuredContent.interaction_preview = {
                    ...preview.metadata,
                    debug_media_path: debugMediaPath,
                };
                content.push({ type: 'image', data: preview.data.toString('base64'), mimeType: 'image/png' });
            }
            catch (error) {
                debugLog('preview', 'capture-error', {
                    error: error instanceof Error ? error.message : String(error),
                });
                structuredContent.interaction_preview = {
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        }
        return {
            content,
            structuredContent,
        };
    }
    async executeAction(sessionId, input) {
        switch (input.action) {
            case 'key':
                return this.runKey(sessionId, input);
            case 'type':
                return this.runType(sessionId, input);
            case 'mouse_move':
                return this.runMouseMove(sessionId, input);
            case 'left_click':
                return this.runClick(sessionId, input, 'left');
            case 'right_click':
                return this.runClick(sessionId, input, 'right');
            case 'middle_click':
                return this.runClick(sessionId, input, 'middle');
            case 'double_click':
                return this.runClick(sessionId, input, 'double');
            case 'left_click_drag':
                return this.runDrag(sessionId, input, 'left');
            case 'right_click_drag':
                return this.runDrag(sessionId, input, 'right');
            case 'scroll':
                return this.runScroll(sessionId, input);
            case 'get_screenshot':
                return this.runScreenshot(sessionId, input);
            case 'sleep':
                return this.runSleep(sessionId, input);
        }
    }
    async runKey(sessionId, input) {
        if (!input.text) {
            throw new Error('Text required for key');
        }
        debugLog('action', 'key-start', { session_id: sessionId, text: input.text });
        await this.runAgentInput(async () => {
            const keys = toKeys(input.text);
            await keyboard.pressKey(...keys);
            await keyboard.releaseKey(...keys);
        });
        debugLog('action', 'key-complete', { session_id: sessionId, text: input.text });
        return {
            data: { ok: true, action: input.action, text: input.text },
            previewFromCursor: true,
        };
    }
    async runType(sessionId, input) {
        if (!input.text) {
            throw new Error('Text required for type');
        }
        debugLog('action', 'type-start', { session_id: sessionId, text_length: input.text.length });
        await this.runAgentInput(async () => {
            if (process.platform === 'linux' && hasXdotool()) {
                xdotoolType(input.text);
            }
            else {
                await keyboard.type(input.text);
            }
        });
        debugLog('action', 'type-complete', { session_id: sessionId, text_length: input.text.length });
        return {
            data: { ok: true, action: input.action, text_length: input.text.length },
            previewFromCursor: true,
        };
    }
    async runMouseMove(sessionId, input) {
        const target = this.requireTarget(input);
        debugLog('action', 'mouse-move-target', { session_id: sessionId, target });
        await this.driver.flash(target.monitor.monitor_id, target.local_x, target.local_y);
        await this.runAgentInput(async () => {
            await mouse.setPosition(new Point(target.x, target.y));
        });
        return {
            data: { ok: true, action: input.action, target },
            previewTarget: target,
        };
    }
    async runClick(sessionId, input, kind) {
        const target = input.coordinate ? this.requireTarget(input) : await this.targetFromCursor();
        debugLog('action', 'click-target', {
            session_id: sessionId,
            kind,
            target,
            target_source: input.coordinate ? 'coordinate' : 'cursor',
        });
        await this.driver.flash(target.monitor.monitor_id, target.local_x, target.local_y);
        await this.runAgentInput(async () => {
            if (input.coordinate) {
                await mouse.setPosition(new Point(target.x, target.y));
            }
            if (kind === 'left') {
                await mouse.leftClick();
            }
            else if (kind === 'right') {
                await mouse.rightClick();
            }
            else if (kind === 'middle') {
                await mouse.click(Button.MIDDLE);
            }
            else {
                await mouse.doubleClick(Button.LEFT);
            }
        });
        return {
            data: { ok: true, action: input.action, target },
            previewTarget: target,
        };
    }
    async runDrag(sessionId, input, button) {
        const target = this.requireTarget(input);
        const dragButton = button === 'left' ? Button.LEFT : Button.RIGHT;
        debugLog('action', 'drag-target', { session_id: sessionId, target, button });
        await this.driver.flash(target.monitor.monitor_id, target.local_x, target.local_y);
        await this.runAgentInput(async () => {
            await mouse.pressButton(dragButton);
            await mouse.setPosition(new Point(target.x, target.y));
            await mouse.releaseButton(dragButton);
        });
        return {
            data: { ok: true, action: input.action, target },
            previewTarget: target,
        };
    }
    async runScroll(sessionId, input) {
        const target = this.requireTarget(input);
        if (!input.text) {
            throw new Error('Text required for scroll (direction like "up", "down:500")');
        }
        const [direction, amountText] = input.text.split(':');
        const amount = amountText ? parseInt(amountText, 10) : 300;
        if (!direction || Number.isNaN(amount) || amount <= 0) {
            throw new Error(`Invalid scroll command: ${input.text}`);
        }
        debugLog('action', 'scroll-target', {
            session_id: sessionId,
            target,
            direction,
            amount,
        });
        await this.driver.flash(target.monitor.monitor_id, target.local_x, target.local_y);
        await this.runAgentInput(async () => {
            await mouse.setPosition(new Point(target.x, target.y));
            switch (direction.toLowerCase()) {
                case 'up':
                    await mouse.scrollUp(amount);
                    break;
                case 'down':
                    await mouse.scrollDown(amount);
                    break;
                case 'left':
                    await mouse.scrollLeft(amount);
                    break;
                case 'right':
                    await mouse.scrollRight(amount);
                    break;
                default:
                    throw new Error(`Invalid scroll direction: ${direction}`);
            }
        });
        return {
            data: {
                ok: true, action: input.action, target, amount, direction,
            },
            previewTarget: target,
        };
    }
    async runScreenshot(sessionId, input) {
        const monitor = this.requireMonitor(input.monitor_id);
        debugLog('action', 'screenshot-start', {
            session_id: sessionId,
            monitor_id: monitor.monitor_id,
        });
        await delay(1000);
        const screenshot = await this.driver.screenshot(monitor.monitor_id);
        const apiScale = getSizeToApiScale(screenshot.width, screenshot.height);
        const imageWidth = Math.max(1, Math.floor(screenshot.width * apiScale));
        const imageHeight = Math.max(1, Math.floor(screenshot.height * apiScale));
        this.imageSizes.set(monitor.monitor_id, { width: imageWidth, height: imageHeight });
        const cursor = await this.cursorInMonitorImage(monitor, imageWidth, imageHeight);
        const optimized = await this.renderScreenshot(screenshot.data, imageWidth, imageHeight, cursor);
        const debugMediaPath = saveDebugMedia('mcp-screenshot-response', optimized, 'png', {
            session_id: sessionId,
            monitor_id: monitor.monitor_id,
            image_width: imageWidth,
            image_height: imageHeight,
            cursor,
        });
        await this.driver.flash(monitor.monitor_id, cursor?.local_x ?? Math.round(monitor.width / 2), cursor?.local_y ?? Math.round(monitor.height / 2));
        const structuredContent = {
            ok: true,
            action: input.action,
            monitor_id: monitor.monitor_id,
            image_width: imageWidth,
            image_height: imageHeight,
            monitor,
            cursor,
            debug_media_path: debugMediaPath,
        };
        return {
            data: structuredContent,
            content: [
                { type: 'image', data: optimized.toString('base64'), mimeType: 'image/png' },
            ],
        };
    }
    async runSleep(sessionId, input) {
        if (input.duration_ms === undefined) {
            throw new Error('duration_ms is required for sleep');
        }
        if (!Number.isInteger(input.duration_ms) || input.duration_ms < 0 || input.duration_ms > 60_000) {
            throw new Error('duration_ms for sleep must be an integer between 0 and 60000');
        }
        debugLog('action', 'sleep-start', {
            session_id: sessionId,
            duration_ms: input.duration_ms,
        });
        await delay(input.duration_ms);
        debugLog('action', 'sleep-complete', {
            session_id: sessionId,
            duration_ms: input.duration_ms,
        });
        return {
            data: {
                ok: true,
                action: input.action,
                duration_ms: input.duration_ms,
            },
        };
    }
    async renderScreenshot(buffer, width, height, cursor) {
        const image = sharp(buffer).resize(width, height);
        if (!cursor) {
            return image.png({ quality: 80, compressionLevel: 9 }).toBuffer();
        }
        const crosshair = Buffer.from(`<svg width="${width}" height="${height}">
<line x1="${Math.max(0, cursor.x - 20)}" y1="${cursor.y}" x2="${Math.min(width, cursor.x + 20)}" y2="${cursor.y}" stroke="#ff0000" stroke-width="3"/>
<line x1="${cursor.x}" y1="${Math.max(0, cursor.y - 20)}" x2="${cursor.x}" y2="${Math.min(height, cursor.y + 20)}" stroke="#ff0000" stroke-width="3"/>
</svg>`);
        return image.composite([{ input: crosshair, left: 0, top: 0 }]).png({ quality: 80, compressionLevel: 9 }).toBuffer();
    }
    async cursorInMonitorImage(monitor, imageWidth, imageHeight) {
        const pos = await mouse.getPosition();
        if (pos.x < monitor.x || pos.x >= monitor.x + monitor.width || pos.y < monitor.y || pos.y >= monitor.y + monitor.height) {
            return null;
        }
        const localX = pos.x - monitor.x;
        const localY = pos.y - monitor.y;
        return {
            global_x: pos.x,
            global_y: pos.y,
            local_x: localX,
            local_y: localY,
            x: Math.round(localX * (imageWidth / monitor.width)),
            y: Math.round(localY * (imageHeight / monitor.height)),
        };
    }
    async runAgentInput(callback) {
        this.agentInputDepth += 1;
        this.ignoreInputUntil = now() + inputIgnoreMs;
        debugLog('input', 'agent-input-start', {
            agent_input_depth: this.agentInputDepth,
            ignore_input_until: this.ignoreInputUntil,
        });
        try {
            await callback();
        }
        finally {
            this.agentInputDepth = Math.max(0, this.agentInputDepth - 1);
            this.ignoreInputUntil = now() + inputIgnoreMs;
            debugLog('input', 'agent-input-complete', {
                agent_input_depth: this.agentInputDepth,
                ignore_input_until: this.ignoreInputUntil,
            });
        }
    }
    requireTarget(input) {
        if (!input.coordinate) {
            throw new Error(`Coordinate required for ${input.action}`);
        }
        const monitor = this.requireMonitor(input.monitor_id);
        const imageSize = this.imageSizes.get(monitor.monitor_id) ?? { width: monitor.width, height: monitor.height };
        return { ...localToGlobal(monitor, input.coordinate, imageSize), monitor };
    }
    requireMonitor(monitorId) {
        if (!monitorId) {
            throw new Error('monitor_id is required for this action');
        }
        const monitor = this.session?.monitors.find((candidate) => candidate.monitor_id === monitorId);
        if (!monitor) {
            throw new Error(`Unknown monitor_id: ${monitorId}`);
        }
        return monitor;
    }
    async targetFromCursor() {
        const pos = await mouse.getPosition();
        const monitor = this.monitorForGlobal(pos.x, pos.y);
        if (!monitor) {
            throw new Error(`Cursor is outside known monitor bounds at ${pos.x},${pos.y}`);
        }
        const target = {
            x: pos.x,
            y: pos.y,
            local_x: pos.x - monitor.x,
            local_y: pos.y - monitor.y,
            monitor,
        };
        debugLog('action', 'target-from-cursor', { target });
        return target;
    }
    monitorForGlobal(x, y) {
        return this.session?.monitors.find((monitor) => x >= monitor.x && x < monitor.x + monitor.width && y >= monitor.y && y < monitor.y + monitor.height);
    }
    recordManualInput() {
        if (!this.session || this.isIgnoringInput()) {
            debugLog('input', 'manual-input-ignored', {
                has_session: Boolean(this.session),
                agent_input_depth: this.agentInputDepth,
                ignore_input_until: this.ignoreInputUntil,
            });
            return;
        }
        this.pauseUntil = now() + pauseMs;
        this.session.status = 'paused';
        debugLog('input', 'manual-input-pause', {
            session_id: this.session.session_id,
            pause_until: this.pauseUntil,
        });
        void this.driver.setOverlayStatus('paused', 'Paused due to user interaction');
        if (this.pauseTimer) {
            clearTimeout(this.pauseTimer);
        }
        this.pauseTimer = setTimeout(() => {
            if (!this.session || now() < this.pauseUntil) {
                return;
            }
            this.session.status = 'active';
            debugLog('input', 'manual-input-resume', {
                session_id: this.session.session_id,
            });
            void this.driver.setOverlayStatus('active', 'Agent is using your computer');
        }, pauseMs + 50);
    }
    handleEscapeInput() {
        if (this.isIgnoringInput()) {
            debugLog('input', 'escape-ignored', {
                has_session: Boolean(this.session),
                agent_input_depth: this.agentInputDepth,
                ignore_input_until: this.ignoreInputUntil,
            });
            return;
        }
        void this.endByUserEscape();
    }
    isIgnoringInput() {
        return this.agentInputDepth > 0 || now() < this.ignoreInputUntil;
    }
    async waitForUnpaused() {
        if (!this.session || now() >= this.pauseUntil) {
            return;
        }
        debugLog('queue', 'wait-for-unpaused', {
            session_id: this.session.session_id,
            remaining_ms: this.pauseUntil - now(),
        });
        await delay(Math.min(250, Math.max(50, this.pauseUntil - now())));
        await this.waitForUnpaused();
    }
    async refreshDisplays() {
        if (!this.session) {
            return;
        }
        this.session.monitors = await this.snapshotMonitors(await this.driver.showOverlay());
        debugLog('session-manager', 'refresh-displays', {
            session_id: this.session.session_id,
            monitors: this.session.monitors,
        });
    }
    async snapshotMonitors(displays) {
        const monitors = displays.map(toMonitor);
        debugLog('monitor-snapshot', 'start', { displays });
        try {
            const windows = await this.windowEnumerator();
            for (const monitor of monitors) {
                const seen = new Set();
                const correlations = [];
                for (const window of windows) {
                    const left = Math.max(monitor.x, window.bounds.x);
                    const top = Math.max(monitor.y, window.bounds.y);
                    const right = Math.min(monitor.x + monitor.width, window.bounds.x + window.bounds.width);
                    const bottom = Math.min(monitor.y + monitor.height, window.bounds.y + window.bounds.height);
                    const visibleArea = Math.max(0, right - left) * Math.max(0, bottom - top);
                    const windowArea = window.bounds.width * window.bounds.height;
                    const coverage = windowArea > 0 ? visibleArea / windowArea : 0;
                    const accepted = right > left && bottom > top && coverage >= minVisibleApplicationCoverage && !seen.has(window.id);
                    correlations.push({
                        window_id: window.id,
                        name: window.name,
                        title: window.title,
                        bounds: window.bounds,
                        coverage,
                        accepted,
                    });
                    if (!accepted) {
                        continue;
                    }
                    monitor.visible_applications.push({
                        name: window.name,
                        pid: window.pid,
                        title: window.title,
                        bounds: window.bounds,
                    });
                    seen.add(window.id);
                    if (monitor.visible_applications.length >= maxVisibleApplicationsPerMonitor) {
                        break;
                    }
                }
                debugLog('monitor-snapshot', 'monitor-correlations', {
                    monitor_id: monitor.monitor_id,
                    monitor_index: monitor.index,
                    correlations,
                });
            }
        }
        catch (error) {
            for (const monitor of monitors) {
                monitor.visible_applications_error = error instanceof Error ? error.message : String(error);
            }
            debugLog('monitor-snapshot', 'window-enumerator-error', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
        debugLog('monitor-snapshot', 'complete', { monitors });
        return monitors;
    }
    async capturePreview(target) {
        debugLog('preview', 'capture-start', { target });
        const screenshot = await this.driver.screenshot(target.monitor.monitor_id);
        const centerX = Math.round(target.local_x * (screenshot.width / target.monitor.width));
        const centerY = Math.round(target.local_y * (screenshot.height / target.monitor.height));
        const cropWidth = Math.min(480, screenshot.width);
        const cropHeight = Math.min(320, screenshot.height);
        const left = Math.max(0, Math.min(screenshot.width - cropWidth, centerX - Math.round(cropWidth / 2)));
        const top = Math.max(0, Math.min(screenshot.height - cropHeight, centerY - Math.round(cropHeight / 2)));
        const data = await sharp(screenshot.data)
            .extract({
            left, top, width: cropWidth, height: cropHeight,
        })
            .png({ quality: 80, compressionLevel: 9 })
            .toBuffer();
        debugLog('preview', 'capture-complete', {
            monitor_id: target.monitor.monitor_id,
            source_width: screenshot.width,
            source_height: screenshot.height,
            crop_x: left,
            crop_y: top,
            crop_width: cropWidth,
            crop_height: cropHeight,
            center_x: centerX,
            center_y: centerY,
            bytes: data.length,
        });
        return {
            data,
            metadata: {
                ok: true,
                monitor_id: target.monitor.monitor_id,
                crop_x: left,
                crop_y: top,
                crop_width: cropWidth,
                crop_height: cropHeight,
                center_x: centerX,
                center_y: centerY,
                delay_ms: 500,
            },
        };
    }
    result(data) {
        return {
            content: [],
            structuredContent: data,
        };
    }
}
let xdotoolAvailable;
function hasXdotool() {
    if (xdotoolAvailable === undefined) {
        try {
            execFileSync('which', ['xdotool'], { stdio: 'ignore' });
            xdotoolAvailable = true;
        }
        catch {
            xdotoolAvailable = false;
        }
    }
    return xdotoolAvailable;
}
function xdotoolType(text) {
    execFileSync('xdotool', [
        'type',
        '--clearmodifiers',
        '--delay',
        String(keyboard.config.autoDelayMs),
        '--',
        text,
    ], {
        env: { ...process.env, DISPLAY: process.env.DISPLAY || ':1' },
    });
}
