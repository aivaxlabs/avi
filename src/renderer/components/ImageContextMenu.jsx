import { Copy, Download, ExternalLink, FolderOpen, Image } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';
import { Presence } from './Overlay.jsx';

const imageActions = [
  ['open', 'Open', ExternalLink, true],
  ['reveal', 'Open in explorer', FolderOpen, true],
  ['copy-image', 'Copy image', Image, false],
  ['copy-path', 'Copy path', Copy, true],
  ['save-as', 'Save as...', Download, false],
];

export function useImageContextMenu() {
  const [menu, setMenu] = useState(null);
  const targetRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menu) return undefined;
    const controller = new AbortController();
    window.addEventListener('pointerdown', (event) => {
      if (!menuRef.current?.contains(event.target)) setMenu(null);
    }, { signal: controller.signal, capture: true });
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      setMenu(null);
      targetRef.current?.focus();
    }, { signal: controller.signal, capture: true });
    window.addEventListener('resize', () => setMenu(null), { signal: controller.signal });
    menuRef.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
    return () => controller.abort();
  }, [menu]);

  const openMenu = useCallback((event, attachment) => {
    event.preventDefault();
    event.stopPropagation();
    targetRef.current = event.currentTarget;
    setMenu({
      attachment,
      left: Math.max(8, Math.min(event.clientX, window.innerWidth - 198)),
      top: Math.max(8, Math.min(event.clientY, window.innerHeight - 200)),
    });
  }, []);

  return [openMenu, <Presence key="image-menu" when={menu}>{(menu) => createPortal(
    <DropdownMenu
      ref={menuRef}
      className="image-context-menu"
      fixed
      role="menu"
      aria-label={`Actions for ${menu.attachment.name}`}
      style={{ left: menu.left, top: menu.top }}
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]:not(:disabled)')];
        const index = items.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}
    >
      {imageActions.map(([action, label, Icon, requiresPath]) => (
        <DropdownMenuItem
          key={action}
          icon={<Icon size={14} />}
          role="menuitem"
          disabled={requiresPath && !menu.attachment.path}
          onClick={() => {
            const { path, dataUrl, name } = menu.attachment;
            setMenu(null);
            targetRef.current?.focus();
            void window.chatApp.attachments.imageAction(
              path ? { action, path } : { action, dataUrl, name },
            );
          }}
        >
          {label}
        </DropdownMenuItem>
      ))}
    </DropdownMenu>,
    document.body,
  )}</Presence>];
}
