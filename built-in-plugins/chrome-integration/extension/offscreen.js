const daemonUrl = "ws://127.0.0.1:55334/extension";
let socket;
let reconnectTimer;
let heartbeatTimer;

connect();

chrome.runtime.onMessage.addListener(message => {
  if (message?.target !== "offscreen") return;
  if (message.type === "send" && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message.payload));
  }
  if (message.type === "reconnect") connect();
});

function connect() {
  clearTimeout(reconnectTimer);
  if (socket && socket.readyState < WebSocket.CLOSING) return;
  socket = new WebSocket(daemonUrl);
  socket.addEventListener("open", () => {
    chrome.runtime.sendMessage({ source: "offscreen", type: "connected" });
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => send({ type: "pong", timestamp: Date.now() }), 15000);
  });
  socket.addEventListener("message", event => {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    chrome.runtime.sendMessage({ source: "offscreen", type: "message", payload });
  });
  socket.addEventListener("close", () => {
    clearInterval(heartbeatTimer);
    chrome.runtime.sendMessage({ source: "offscreen", type: "disconnected" });
    reconnectTimer = setTimeout(connect, 1500);
  });
  socket.addEventListener("error", () => socket.close());
}

function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}
