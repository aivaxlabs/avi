import { Minus, Square, X } from 'lucide-react';

export function WindowControls() {
  if (navigator.userAgent.includes('Mac')) {
    return <div className="window-drag mac-drag" />;
  }

  return (
    <div className="window-controls">
      <div className="window-drag" />
      <button type="button" onClick={() => window.chatApp.window.minimize()} aria-label="Minimize">
        <Minus size={14} />
      </button>
      <button type="button" onClick={() => window.chatApp.window.maximize()} aria-label="Maximize">
        <Square size={12} />
      </button>
      <button type="button" className="danger" onClick={() => window.chatApp.window.close()} aria-label="Close">
        <X size={15} />
      </button>
    </div>
  );
}
