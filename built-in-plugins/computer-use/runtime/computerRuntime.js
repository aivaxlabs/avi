import { Button, Key, keyboard, mouse, Point, } from '@nut-tree-fork/nut-js';
import { execFile, execFileSync, } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { toKeys } from './xdotoolStringToKeys.js';
import { debugLog, saveDebugMedia } from './utils/debugLog.js';
const execFileAsync = promisify(execFile);
const maxLongEdge = 1568;
const maxPixels = 1.15 * 1024 * 1024;
const pauseMs = 5000;
const inputIgnoreMs = 750;
const previewDelayMs = 500;
const actionDelayMs = 250;
const maxVisibleApplicationsPerMonitor = 12;
const minVisibleApplicationCoverage = 0.05;
const overlayTitle = 'Avi Computer Use overlay';
const displayEvents = ['display-added', 'display-removed', 'display-metrics-changed'];
const crosshairBgra = Buffer.from([0, 0, 255, 255]);
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
        .filter((window) => window.title || window.name.toLowerCase() !== 'electron')
        .filter((window) => window.title !== overlayTitle);
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
        input_bounds: display.input_bounds ?? { x: display.x, y: display.y, width: display.width, height: display.height },
        is_primary: display.is_primary,
        visible_applications: [],
    };
}
function inputToLocal(monitor, x, y) {
    const input = monitor.input_bounds;
    return {
        local_x: Math.round((x - input.x) * (monitor.width / input.width)),
        local_y: Math.round((y - input.y) * (monitor.height / input.height)),
    };
}
function containsInputPoint(monitor, x, y) {
    const input = monitor.input_bounds;
    return x >= input.x && x < input.x + input.width && y >= input.y && y < input.y + input.height;
}
function now() {
    return Date.now();
}
export function localToGlobal(monitor, coordinate, imageSize) {
    if (coordinate[0] < 0 || coordinate[1] < 0 || coordinate[0] >= imageSize.width || coordinate[1] >= imageSize.height) {
        throw new Error(`Coordinate (${coordinate[0]}, ${coordinate[1]}) is outside monitor ${monitor.monitor_id} coordinate space of ${imageSize.width}x${imageSize.height}`);
    }
    const input = monitor.input_bounds;
    return {
        x: input.x + Math.round(coordinate[0] * (input.width / imageSize.width)),
        y: input.y + Math.round(coordinate[1] * (input.height / imageSize.height)),
        local_x: Math.round(coordinate[0] * (monitor.width / imageSize.width)),
        local_y: Math.round(coordinate[1] * (monitor.height / imageSize.height)),
    };
}
export class ElectronComputerDriver {
    electron;
    windows = new Map();
    statusText = 'Agent is using your computer';
    cursorTimer;
    escapeRegistered = false;
    escapeCallback;
    displaysChangedCallback;
    notifyDisplaysChanged = () => {
        this.displaysChangedCallback?.();
    };
    onEscape(callback) {
        this.escapeCallback = callback;
    }
    onDisplaysChanged(callback) {
        this.displaysChangedCallback = callback;
    }
    async start() {
        if (!this.electron) {
            this.electron = await import('electron');
            for (const event of displayEvents) {
                this.electron.screen.on(event, this.notifyDisplaysChanged);
            }
        }
        return this.electron;
    }
    async listDisplays() {
        const { screen } = await this.start();
        const primaryId = String(screen.getPrimaryDisplay().id);
        const displays = screen.getAllDisplays().map((display, index) => {
            // nut-js and get-windows use physical pixels on Windows and X11, but points (DIP) on macOS.
            const origin = process.platform === 'win32' ? screen.dipToScreenRect(null, display.bounds) : display.nativeOrigin;
            return {
                id: String(display.id),
                index: index + 1,
                name: display.label || `Monitor ${index + 1}`,
                x: display.bounds.x,
                y: display.bounds.y,
                width: display.bounds.width,
                height: display.bounds.height,
                scale_factor: display.scaleFactor,
                input_bounds: process.platform === 'darwin' ? { ...display.bounds } : {
                    x: origin.x,
                    y: origin.y,
                    width: Math.round(display.bounds.width * display.scaleFactor),
                    height: Math.round(display.bounds.height * display.scaleFactor),
                },
                is_primary: String(display.id) === primaryId,
            };
        });
        debugLog('electron-driver', 'list-displays-result', { displays });
        return displays;
    }
    async showOverlay() {
        const { BrowserWindow } = await this.start();
        const displays = await this.listDisplays();
        const activeIds = new Set(displays.map((display) => display.id));
        for (const [id, win] of this.windows) {
            if (!activeIds.has(id)) {
                win.destroy();
                this.windows.delete(id);
            }
        }
        await Promise.all(displays.map(async (display) => {
            let win = this.windows.get(display.id);
            if (!win || win.isDestroyed()) {
                const overlay = new BrowserWindow({
                    title: overlayTitle,
                    x: display.x,
                    y: display.y,
                    width: display.width,
                    height: display.height,
                    show: false,
                    frame: false,
                    transparent: true,
                    resizable: false,
                    movable: false,
                    focusable: false,
                    alwaysOnTop: true,
                    skipTaskbar: true,
                    hasShadow: false,
                    webPreferences: {
                        preload: fileURLToPath(new URL('./overlayPreload.cjs', import.meta.url)),
                        contextIsolation: true,
                        nodeIntegration: false,
                        sandbox: true,
                        backgroundThrottling: false,
                    },
                });
                overlay.setAlwaysOnTop(true, 'screen-saver');
                overlay.setIgnoreMouseEvents(true, { forward: true });
                overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                overlay.setContentProtection(true);
                overlay.webContents.ipc.on('stop-session', () => this.escapeCallback?.());
                overlay.webContents.ipc.on('mouse-capture', (_event, enabled) => {
                    if (!overlay.isDestroyed()) {
                        overlay.setIgnoreMouseEvents(enabled !== true, { forward: true });
                    }
                });
                await overlay.loadFile(fileURLToPath(new URL('./overlay.html', import.meta.url)));
                this.windows.set(display.id, overlay);
                win = overlay;
            }
            win.setBounds({ x: display.x, y: display.y, width: display.width, height: display.height });
            win.showInactive();
            win.webContents.send('state', { status: 'active', text: this.statusText });
        }));
        this.startCursorIndicator();
        await this.setEscapeShortcut(true);
        debugLog('electron-driver', 'show-overlay-result', { displays });
        return displays;
    }
    async hideOverlay() {
        debugLog('electron-driver', 'hide-overlay');
        this.stopCursorIndicator();
        await this.setEscapeShortcut(false);
        for (const win of this.windows.values()) {
            if (!win.isDestroyed()) {
                win.destroy();
            }
        }
        this.windows.clear();
    }
    async setEscapeShortcut(enabled) {
        const { globalShortcut } = await this.start();
        if (!enabled && this.escapeRegistered) {
            globalShortcut.unregister('Escape');
            this.escapeRegistered = false;
        }
        else if (enabled && !this.escapeRegistered && this.windows.size > 0) {
            this.escapeRegistered = globalShortcut.register('Escape', () => this.escapeCallback?.());
        }
        debugLog('electron-driver', 'escape-shortcut', { enabled, registered: this.escapeRegistered });
    }
    async setOverlayStatus(status, text) {
        debugLog('electron-driver', 'set-overlay-status', { status, text });
        this.statusText = text;
        this.sendToOverlays('state', { status, text });
    }
    async flash(monitorId, x, y) {
        const win = this.windows.get(monitorId);
        if (win && !win.isDestroyed()) {
            win.webContents.send('flash', { x, y });
        }
    }
    async screenshot(monitorId) {
        const { desktopCapturer } = await this.start();
        const displays = await this.listDisplays();
        const display = displays.find((candidate) => candidate.id === monitorId);
        if (!display) {
            throw new Error(`Unknown monitor_id: ${monitorId}`);
        }
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: {
                width: Math.max(1, Math.round(display.width * display.scale_factor)),
                height: Math.max(1, Math.round(display.height * display.scale_factor)),
            },
        });
        const source = sources.find((candidate) => candidate.display_id === display.id)
            ?? sources[displays.indexOf(display)];
        if (!source) {
            throw new Error(`No screenshot source for monitor_id: ${monitorId}`);
        }
        const { width, height } = source.thumbnail.getSize();
        debugLog('electron-driver', 'screenshot-result', {
            monitor_id: monitorId,
            source_id: source.id,
            width,
            height,
        });
        return { image: source.thumbnail, width, height };
    }
    async dispose() {
        if (!this.electron) {
            return;
        }
        debugLog('electron-driver', 'dispose');
        await this.hideOverlay();
        for (const event of displayEvents) {
            this.electron.screen.removeListener(event, this.notifyDisplaysChanged);
        }
        this.electron = undefined;
    }
    sendToOverlays(channel, payload) {
        for (const win of this.windows.values()) {
            if (!win.isDestroyed()) {
                win.webContents.send(channel, payload);
            }
        }
    }
    startCursorIndicator() {
        if (this.cursorTimer) {
            return;
        }
        const update = () => {
            const cursor = this.electron.screen.getCursorScreenPoint();
            for (const win of this.windows.values()) {
                if (win.isDestroyed()) {
                    continue;
                }
                const bounds = win.getBounds();
                win.webContents.send('cursor-indicator', {
                    visible: cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width && cursor.y >= bounds.y && cursor.y < bounds.y + bounds.height,
                    x: cursor.x - bounds.x,
                    y: cursor.y - bounds.y,
                });
            }
        };
        update();
        this.cursorTimer = setInterval(update, 33);
    }
    stopCursorIndicator() {
        if (!this.cursorTimer) {
            return;
        }
        clearInterval(this.cursorTimer);
        this.cursorTimer = undefined;
        this.sendToOverlays('cursor-indicator', { visible: false });
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
        const monitor = monitors.find((candidate) => containsInputPoint(candidate, cursorPosition.x, cursorPosition.y));
        const local = monitor ? inputToLocal(monitor, cursorPosition.x, cursorPosition.y) : undefined;
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
                x: local?.local_x ?? null,
                y: local?.local_y ?? null,
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
                scale_factor: candidate.scale_factor,
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
        const keys = toKeys(input.text);
        const pressesEscape = keys.includes(Key.Escape);
        if (pressesEscape) {
            await this.driver.setEscapeShortcut(false);
        }
        try {
            await this.runAgentInput(async () => {
                await keyboard.pressKey(...keys);
                await keyboard.releaseKey(...keys);
            });
        }
        finally {
            if (pressesEscape && this.session) {
                await this.driver.setEscapeShortcut(true);
            }
        }
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
        const optimized = await this.renderScreenshot(screenshot.image, imageWidth, imageHeight, cursor);
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
    async renderScreenshot(image, width, height, cursor) {
        const resized = image.resize({ width, height, quality: 'best' });
        if (!cursor) {
            return resized.toPNG();
        }
        const bitmap = resized.toBitmap();
        const paint = (x, y) => {
            if (x >= 0 && x < width && y >= 0 && y < height) {
                bitmap.set(crosshairBgra, (y * width + x) * 4);
            }
        };
        for (let offset = -20; offset <= 20; offset += 1) {
            for (let stroke = -1; stroke <= 1; stroke += 1) {
                paint(cursor.x + offset, cursor.y + stroke);
                paint(cursor.x + stroke, cursor.y + offset);
            }
        }
        const { nativeImage } = await this.driver.start();
        return nativeImage.createFromBitmap(bitmap, { width, height }).toPNG();
    }
    async cursorInMonitorImage(monitor, imageWidth, imageHeight) {
        const pos = await mouse.getPosition();
        if (!containsInputPoint(monitor, pos.x, pos.y)) {
            return null;
        }
        const input = monitor.input_bounds;
        return {
            global_x: pos.x,
            global_y: pos.y,
            ...inputToLocal(monitor, pos.x, pos.y),
            x: Math.round((pos.x - input.x) * (imageWidth / input.width)),
            y: Math.round((pos.y - input.y) * (imageHeight / input.height)),
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
            ...inputToLocal(monitor, pos.x, pos.y),
            monitor,
        };
        debugLog('action', 'target-from-cursor', { target });
        return target;
    }
    monitorForGlobal(x, y) {
        return this.session?.monitors.find((monitor) => containsInputPoint(monitor, x, y));
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
                const input = monitor.input_bounds;
                for (const window of windows) {
                    const left = Math.max(input.x, window.bounds.x);
                    const top = Math.max(input.y, window.bounds.y);
                    const right = Math.min(input.x + input.width, window.bounds.x + window.bounds.width);
                    const bottom = Math.min(input.y + input.height, window.bounds.y + window.bounds.height);
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
                    const origin = inputToLocal(monitor, window.bounds.x, window.bounds.y);
                    monitor.visible_applications.push({
                        name: window.name,
                        pid: window.pid,
                        title: window.title,
                        bounds: {
                            x: monitor.x + origin.local_x,
                            y: monitor.y + origin.local_y,
                            width: Math.round(window.bounds.width * (monitor.width / input.width)),
                            height: Math.round(window.bounds.height * (monitor.height / input.height)),
                        },
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
        const data = screenshot.image
            .crop({ x: left, y: top, width: cropWidth, height: cropHeight })
            .toPNG();
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
