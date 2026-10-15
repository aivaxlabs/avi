import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ProviderPanel } from './ProviderPanel.jsx';

const themeTokens = [
  ...[0, 1, 2, 3, 4, 5].map((level) => `--background-${level}`),
  ...[1, 2, 3, 4, 5].map((level) => `--text-${level}`),
  '--border-color',
  '--item-hover',
  '--item-active',
  '--primary-color',
  '--success-color',
  '--warn-color',
  '--danger-color',
  '--link-color',
  '--font-ui',
  '--font-code',
  ...['xs', 'sm', 'md', 'lg', 'xl', 'xxl'].map((size) => `--font-${size}`),
];

const bridgeScript = `<script>
(() => {
  const pending = new Map();
  let nextId = 0;
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const message = event.data ?? {};
    if (message.type === 'avi:theme') document.getElementById('avi-theme').textContent = message.css;
    if (message.type !== 'avi:result' || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.ok ? resolve(message.value) : reject(new Error(message.error));
  });
  window.avi = Object.freeze({
    invoke(action, input = null) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        window.parent.postMessage({ type: 'avi:invoke', id, action, input }, '*');
      });
    },
  });
})();
</script>`;

const nativePageSource = {
  label: 'Action page',
  load: ({ panelId }) => window.chatApp.actionPages.load({ pageId: panelId }),
  invokeAction: ({ panelId, action, input }) => window.chatApp.actionPages.invokeAction({
    pageId: panelId,
    action,
    input,
  }),
};

function readThemeCss() {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const variables = themeTokens
    .map((token) => `${token}: ${style.getPropertyValue(token).trim()};`)
    .join(' ');
  return `:root { ${variables} color-scheme: ${root.dataset.colorScheme === 'dark' ? 'dark' : 'light'}; }
:where(html) { color: var(--text-1); background: var(--background-1); font-family: var(--font-ui); }`;
}

function HtmlActionPage({ page, refreshKey }) {
  const frameRef = useRef(null);
  const [html, setHtml] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setError('');
    window.chatApp.actionPages.load({ pageId: page.id })
      .then((result) => {
        if (!cancelled) setHtml(String(result?.html ?? ''));
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
    return () => {
      cancelled = true;
    };
  }, [page.id, refreshKey]);

  useEffect(() => {
    function onMessage(event) {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow || event.data?.type !== 'avi:invoke') return;
      const { id, action, input } = event.data;
      window.chatApp.actionPages.invokeAction({ pageId: page.id, action, input })
        .then(
          (value) => ({ ok: true, value }),
          (nextError) => ({ ok: false, error: nextError instanceof Error ? nextError.message : String(nextError) }),
        )
        .then((result) => frame.contentWindow?.postMessage({ type: 'avi:result', id, ...result }, '*'));
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [page.id]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      frameRef.current?.contentWindow?.postMessage({ type: 'avi:theme', css: readThemeCss() }, '*');
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  const srcDoc = useMemo(() => {
    if (html == null) return null;
    const preamble = `<style id="avi-theme">${readThemeCss()}</style>${bridgeScript}`;
    return /<head[^>]*>/i.test(html)
      ? html.replace(/<head[^>]*>/i, (head) => `${head}${preamble}`)
      : `${preamble}${html}`;
  }, [html]);

  if (error) {
    return (
      <div className="action-page-state" role="alert">
        <TriangleAlert size={20} aria-hidden="true" />
        <strong>{page.title} could not be loaded</strong>
        <span>{error}</span>
      </div>
    );
  }

  if (srcDoc == null) {
    return (
      <div className="action-page-state">
        <RefreshCw className="spin" size={18} aria-hidden="true" />
        <span>Loading {page.title}…</span>
      </div>
    );
  }

  return (
    <iframe
      ref={frameRef}
      className="action-page-frame"
      title={page.title}
      sandbox="allow-scripts allow-forms allow-popups allow-modals"
      srcDoc={srcDoc}
    />
  );
}

export function ActionPage({ page, refreshKey }) {
  if (page.kind === 'html') return <HtmlActionPage page={page} refreshKey={refreshKey} />;

  return (
    <div className="action-page-native">
      <ProviderPanel
        panel={{ id: page.id, title: page.title, providerName: page.pluginName }}
        source={nativePageSource}
        refreshKey={refreshKey}
      />
    </div>
  );
}
