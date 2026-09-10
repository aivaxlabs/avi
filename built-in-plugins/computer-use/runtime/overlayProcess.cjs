/* eslint-disable camelcase */
/* global require */
const {
	app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen,
} = require('electron');
const {
	appendFileSync, mkdirSync, writeFileSync,
} = require('node:fs');
const {createServer} = require('node:http');
const {tmpdir} = require('node:os');
const {
	dirname, join, resolve,
} = require('node:path');

const windows = new Map();
let statusText = 'Agent is using your computer';
let mediaCounter = 0;
let cursorIndicatorTimer;
let escapeShortcutRegistered = false;
const defaultRunId = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${process.pid}`;

function isDebugEnabled() {
	return process.env.COMPUTER_USE_DEBUG_ENABLED === '1';
}

function getDebugRunId() {
	return process.env.COMPUTER_USE_DEBUG_RUN_ID || defaultRunId;
}

function getDebugMediaDir() {
	return resolve(process.env.COMPUTER_USE_DEBUG_MEDIA_DIR || join(tmpdir(), 'computer-use-mcp-debug', getDebugRunId()));
}

function debugLog(component, event, data) {
	if (!isDebugEnabled()) {
		return;
	}

	try {
		const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
		const payload = data ? ` Data=${JSON.stringify(data)}` : '';
		const line = `[${timestamp}] [DEBUG] Component="${component}" Event="${event}"${payload}\n`;
		const logPath = resolve(process.env.COMPUTER_USE_DEBUG_LOG_PATH || 'debug.log');
		mkdirSync(dirname(logPath), {recursive: true});
		appendFileSync(logPath, line, 'utf8');
	} catch {
	}
}

function saveDebugMedia(kind, data, extension, metadata) {
	if (!isDebugEnabled()) {
		return undefined;
	}

	try {
		const mediaDir = getDebugMediaDir();
		mkdirSync(mediaDir, {recursive: true});
		mediaCounter += 1;
		const safeKind = kind.replaceAll(/[^a-z0-9_-]/gi, '-').toLowerCase();
		const filePath = join(mediaDir, `${process.pid}-${String(mediaCounter).padStart(4, '0')}-${safeKind}.${extension}`);
		writeFileSync(filePath, data);
		debugLog('overlay-media', 'saved', {
			kind, file_path: filePath, bytes: data.length, ...metadata,
		});
		return filePath;
	} catch {
		return undefined;
	}
}

function send(message) {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

function displays() {
	const primaryId = String(screen.getPrimaryDisplay().id);
	const currentDisplays = screen.getAllDisplays().map((display, index) => ({
		id: String(display.id),
		index: index + 1,
		name: display.label || `Monitor ${index + 1}`,
		x: display.bounds.x,
		y: display.bounds.y,
		width: display.bounds.width,
		height: display.bounds.height,
		scale_factor: display.scaleFactor,
		is_primary: String(display.id) === primaryId,
	}));
	debugLog('overlay', 'displays', {displays: currentDisplays});
	return currentDisplays;
}

function overlayHtml() {
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;font-family:Segoe UI,Arial,sans-serif}
.frame{position:fixed;inset:0;border:4px solid rgba(63,180,255,.95);box-shadow:inset 0 0 22px rgba(63,180,255,.8),0 0 28px rgba(63,180,255,.7);box-sizing:border-box;animation:pulse 1.8s ease-in-out infinite}
.badge{position:fixed;top:14px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:14px;padding:8px 10px 8px 14px;border-radius:999px;background:rgba(5,20,32,.88);color:#fff;font-size:13px;font-weight:600;box-shadow:0 8px 30px rgba(0,0,0,.35);letter-spacing:.2px}
.badge-text{white-space:nowrap}
.stop-button{display:flex;align-items:center;gap:7px;height:30px;padding:0 8px 0 13px;border:0;border-radius:999px;background:rgba(255,255,255,.22);color:#fff;font:inherit;font-weight:500;letter-spacing:0;cursor:pointer}
.stop-button:hover{background:rgba(255,255,255,.3)}
.stop-button:active{background:rgba(255,255,255,.18)}
.stop-button:focus-visible{outline:2px solid rgba(255,255,255,.82);outline-offset:2px}
.stop-key{display:inline-flex;align-items:center;height:20px;padding:0 7px;border:1px solid rgba(255,255,255,.22);border-radius:7px;color:rgba(255,255,255,.6);font-size:11px;font-weight:500}
.cursor-indicator{position:fixed;left:0;top:0;width:72px;height:72px;margin:-36px 0 0 -36px;border:3px solid rgba(0,120,212,.98);border-radius:50%;box-shadow:0 0 22px rgba(44,196,255,.78),0 0 34px rgba(44,196,255,.48),inset 0 0 10px rgba(255,255,255,.55);opacity:0;pointer-events:none;z-index:8;will-change:transform,opacity;transition:opacity .12s ease}
.paused .frame{border-color:rgba(255,190,68,.96);box-shadow:inset 0 0 22px rgba(255,190,68,.75),0 0 28px rgba(255,190,68,.6)}
.pulse{position:fixed;width:28px;height:28px;margin:-14px 0 0 -14px;border:3px solid rgba(255,255,255,.96);border-radius:50%;box-shadow:0 0 0 4px rgba(63,180,255,.5),0 0 24px rgba(63,180,255,.9);animation:flash .75s ease-out forwards}
@keyframes pulse{0%,100%{opacity:.86}50%{opacity:1}}
@keyframes flash{0%{transform:scale(.6);opacity:1}100%{transform:scale(2.8);opacity:0}}
</style>
</head>
<body>
<div class="frame"></div>
<div class="cursor-indicator" id="cursor-indicator"></div>
<div class="badge">
  <span class="badge-text" id="badge-text"></span>
  <button class="stop-button" id="stop-button" type="button" aria-label="Stop computer control">
    <span>Stop</span>
    <span class="stop-key">ESC</span>
  </button>
</div>
<script>
const {ipcRenderer}=require('electron');
const badgeText=document.getElementById('badge-text');
const stopButton=document.getElementById('stop-button');
const cursorIndicator=document.getElementById('cursor-indicator');
let mouseCaptureEnabled=false;

function setMouseCapture(enabled){
  if(mouseCaptureEnabled===enabled){
    return;
  }

  mouseCaptureEnabled=enabled;
  ipcRenderer.send('overlay-mouse-capture',enabled);
}

window.addEventListener('mousemove',(event)=>{
  setMouseCapture(event.target.closest('#stop-button')!==null);
});
window.addEventListener('mouseleave',()=>setMouseCapture(false));
stopButton.addEventListener('click',()=>ipcRenderer.send('stop-session'));
ipcRenderer.on('state',(_,state)=>{
  document.body.classList.toggle('paused',state.status==='paused');
  badgeText.textContent=state.text;
});
ipcRenderer.on('cursor-indicator',(_,point)=>{
  if(!point.visible){
    cursorIndicator.style.opacity='0';
    return;
  }

  cursorIndicator.style.transform='translate('+point.x+'px,'+point.y+'px)';
  cursorIndicator.style.opacity='1';
});
ipcRenderer.on('flash',(_,point)=>{
  const el=document.createElement('div');
  el.className='pulse';
  el.style.left=point.x+'px';
  el.style.top=point.y+'px';
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),850);
});
</script>
</body>
</html>`;
}

function updateCursorIndicator() {
	const cursor = screen.getCursorScreenPoint();
	for (const win of windows.values()) {
		if (win.isDestroyed()) {
			continue;
		}

		const bounds = win.getBounds();
		const visible = cursor.x >= bounds.x
			&& cursor.x < bounds.x + bounds.width
			&& cursor.y >= bounds.y
			&& cursor.y < bounds.y + bounds.height;
		win.webContents.send('cursor-indicator', {
			visible,
			x: cursor.x - bounds.x,
			y: cursor.y - bounds.y,
		});
	}
}

function startCursorIndicator() {
	if (cursorIndicatorTimer) {
		return;
	}

	updateCursorIndicator();
	cursorIndicatorTimer = setInterval(updateCursorIndicator, 33);
}

function stopCursorIndicator() {
	if (!cursorIndicatorTimer) {
		return;
	}

	clearInterval(cursorIndicatorTimer);
	cursorIndicatorTimer = undefined;
	for (const win of windows.values()) {
		if (!win.isDestroyed()) {
			win.webContents.send('cursor-indicator', {visible: false});
		}
	}
}

function registerEscapeShortcut() {
	if (escapeShortcutRegistered) {
		return;
	}

	escapeShortcutRegistered = globalShortcut.register('Escape', () => {
		debugLog('overlay', 'escape-shortcut');
		send({event: 'escape'});
	});
	debugLog('overlay', 'escape-shortcut-register', {registered: escapeShortcutRegistered});
}

function unregisterEscapeShortcut() {
	if (!escapeShortcutRegistered) {
		return;
	}

	globalShortcut.unregister('Escape');
	escapeShortcutRegistered = false;
	debugLog('overlay', 'escape-shortcut-unregister');
}

async function createOverlayWindows() {
	const currentDisplays = displays();
	debugLog('overlay', 'create-overlay-windows-start', {displays: currentDisplays});
	const activeIds = new Set(currentDisplays.map((display) => display.id));

	for (const [id, win] of windows.entries()) {
		if (!activeIds.has(id)) {
			debugLog('overlay', 'destroy-overlay-window', {display_id: id});
			win.destroy();
			windows.delete(id);
		}
	}

	await Promise.all(currentDisplays.map(async (display) => {
		let win = windows.get(display.id);
		if (!win || win.isDestroyed()) {
			debugLog('overlay', 'create-overlay-window', {display});
			win = new BrowserWindow({
				x: display.x,
				y: display.y,
				width: display.width,
				height: display.height,
				frame: false,
				transparent: true,
				resizable: false,
				movable: false,
				focusable: false,
				alwaysOnTop: true,
				skipTaskbar: true,
				hasShadow: false,
				webPreferences: {
					backgroundThrottling: false,
					contextIsolation: false,
					nodeIntegration: true,
				},
			});
			win.setAlwaysOnTop(true, 'screen-saver');
			win.setIgnoreMouseEvents(true, {forward: true});
			win.setVisibleOnAllWorkspaces(true, {visibleOnFullScreen: true});
			win.setContentProtection(true);
			await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(overlayHtml())}`);
			windows.set(display.id, win);
		}

		win.setBounds({
			x: display.x, y: display.y, width: display.width, height: display.height,
		});
		win.showInactive();
		win.webContents.send('state', {status: 'active', text: statusText});
		debugLog('overlay', 'show-overlay-window', {display_id: display.id, bounds: display});
	}));

	startCursorIndicator();
	registerEscapeShortcut();
	debugLog('overlay', 'create-overlay-windows-complete', {display_count: currentDisplays.length});
	return currentDisplays;
}

function setStatus(status, text) {
	statusText = text;
	debugLog('overlay', 'set-status', {status, text});
	for (const win of windows.values()) {
		if (!win.isDestroyed()) {
			win.webContents.send('state', {status, text});
		}
	}
}

function flash(displayId, x, y) {
	debugLog('overlay', 'flash', {display_id: displayId, x, y});
	const win = windows.get(displayId);
	if (win && !win.isDestroyed()) {
		win.webContents.send('flash', {x, y});
	}
}

async function captureDisplay(displayId) {
	const currentDisplays = displays();
	const display = currentDisplays.find((candidate) => candidate.id === displayId);
	if (!display) {
		debugLog('overlay', 'capture-display-unknown-monitor', {display_id: displayId, displays: currentDisplays});
		throw new Error(`Unknown monitor_id: ${displayId}`);
	}

	debugLog('overlay', 'capture-display-start', {display});
	const sources = await desktopCapturer.getSources({
		types: isDebugEnabled() ? ['screen', 'window'] : ['screen'],
		thumbnailSize: {
			width: Math.max(1, Math.round(display.width * display.scale_factor)),
			height: Math.max(1, Math.round(display.height * display.scale_factor)),
		},
	});
	const sourceInfos = sources.map((source) => ({
		id: source.id,
		name: source.name,
		display_id: source.display_id,
		thumbnail_size: source.thumbnail.getSize(),
	}));
	debugLog('overlay', 'capture-sources', {
		display_id: display.id,
		source_count: sources.length,
		sources: sourceInfos,
	});
	const screenSources = sources.filter((candidate) => String(candidate.id).startsWith('screen:'));
	const candidateSources = screenSources.length > 0 ? screenSources : sources;
	const source = candidateSources.find((candidate) => candidate.display_id === display.id)
		?? candidateSources[currentDisplays.findIndex((candidate) => candidate.id === display.id)];
	if (!source) {
		debugLog('overlay', 'capture-source-missing', {display_id: displayId, sources: sourceInfos});
		throw new Error(`No screenshot source for monitor_id: ${displayId}`);
	}

	const size = source.thumbnail.getSize();
	const png = source.thumbnail.toPNG();
	const debugMediaPath = saveDebugMedia('electron-screen-capture', png, 'png', {
		display_id: display.id,
		source_id: source.id,
		source_name: source.name,
		width: size.width,
		height: size.height,
	});
	debugLog('overlay', 'capture-display-complete', {
		display_id: display.id,
		source_id: source.id,
		source_name: source.name,
		width: size.width,
		height: size.height,
		bytes: png.length,
		debug_media_path: debugMediaPath,
	});
	return {
		data: png.toString('base64'),
		width: size.width,
		height: size.height,
	};
}

function closeAll() {
	debugLog('overlay', 'close-all', {window_count: windows.size});
	stopCursorIndicator();
	unregisterEscapeShortcut();
	for (const win of windows.values()) {
		if (!win.isDestroyed()) {
			win.close();
		}
	}

	windows.clear();
}

async function handle(method, params = {}) {
	debugLog('overlay', 'rpc-handle', {method, params});
	switch (method) {
		case 'displays':
			return {displays: displays()};
		case 'show':
			return {displays: await createOverlayWindows()};
		case 'hide':
			closeAll();
			return {ok: true};
		case 'status': {
			const text = typeof params.text === 'string' ? params.text : statusText;
			setStatus(String(params.status) === 'paused' ? 'paused' : 'active', text);
			return {ok: true};
		}

		case 'flash':
			flash(String(params.displayId), Number(params.x), Number(params.y));
			return {ok: true};
		case 'screenshot':
			return captureDisplay(String(params.displayId));
		case 'shutdown':
			closeAll();
			app.quit();
			return {ok: true};
		default:
			throw new Error(`Unknown overlay method: ${method}`);
	}
}

function readBody(request) {
	return new Promise((resolve, reject) => {
		let body = '';
		request.setEncoding('utf8');
		request.on('data', (chunk) => {
			body += chunk;
		});
		request.on('end', () => {
			try {
				resolve(body ? JSON.parse(body) : {});
			} catch (error) {
				reject(error);
			}
		});
		request.on('error', reject);
	});
}

app.whenReady().then(() => {
	debugLog('overlay', 'ready', {
		debug_run_id: getDebugRunId(),
		media_dir: getDebugMediaDir(),
		log_path: resolve(process.env.COMPUTER_USE_DEBUG_LOG_PATH || 'debug.log'),
	});
	ipcMain.on('stop-session', () => {
		debugLog('overlay', 'stop-button');
		send({event: 'escape'});
	});
	ipcMain.on('overlay-mouse-capture', (event, enabled) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (win && !win.isDestroyed()) {
			win.setIgnoreMouseEvents(!enabled, {forward: true});
		}
	});
	screen.on('display-added', () => {
		debugLog('overlay', 'display-added');
		send({event: 'displays_changed'});
	});
	screen.on('display-removed', () => {
		debugLog('overlay', 'display-removed');
		send({event: 'displays_changed'});
	});
	screen.on('display-metrics-changed', () => {
		debugLog('overlay', 'display-metrics-changed');
		send({event: 'displays_changed'});
	});
	const server = createServer(async (request, response) => {
		if (request.method !== 'POST' || request.url !== '/rpc') {
			response.writeHead(404);
			response.end();
			return;
		}

		try {
			const message = await readBody(request);
			const result = await handle(message.method, message.params);
			response.writeHead(200, {'content-type': 'application/json'});
			response.end(JSON.stringify({result}));
		} catch (error) {
			debugLog('overlay', 'rpc-error', {
				error: error instanceof Error ? error.message : String(error),
			});
			response.writeHead(500, {'content-type': 'application/json'});
			response.end(JSON.stringify({error: error instanceof Error ? error.message : String(error)}));
		}
	});
	server.listen(0, '127.0.0.1', () => {
		const address = server.address();
		debugLog('overlay', 'server-listening', {address});
		send({event: 'ready', port: typeof address === 'object' && address ? address.port : null});
	});
}).catch((error) => {
	debugLog('overlay', 'startup-error', {
		error: error instanceof Error ? error.message : String(error),
	});
	send({event: 'error', error: error instanceof Error ? error.message : String(error)});
});
