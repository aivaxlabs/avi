import { Copy, FileText, FolderSearch } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';

export function useFileReferenceMenu(onOpen, onAction) {
  const [menu, setMenu] = useState(null);
  const targetRef = useRef(null);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const controller = new AbortController();
    window.addEventListener('pointerdown', (event) => {
      if (!menuRef.current?.contains(event.target)) setMenu(null);
    }, { signal: controller.signal });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        setMenu(null);
        targetRef.current?.focus();
      }
    }, { signal: controller.signal });
    window.addEventListener('resize', () => setMenu(null), { signal: controller.signal });
    menuRef.current?.querySelector('[role="menuitem"]')?.focus();
    return () => controller.abort();
  }, [menu]);
  const openMenu = useCallback((event, reference) => {
    event.preventDefault();
    event.stopPropagation();
    targetRef.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({
      reference,
      left: Math.max(8, Math.min(event.clientX || rect.left + 8, window.innerWidth - 188)),
      top: Math.max(8, Math.min(event.clientY || rect.bottom, window.innerHeight - 120)),
    });
  }, []);
  return [openMenu, menu && createPortal(
    <DropdownMenu
      ref={menuRef}
      className="file-reference-context-menu"
      fixed
      role="menu"
      aria-label={`Actions for ${menu.reference.path}`}
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
      {[
        ['open', 'Open', FileText],
        ['copy-path', 'Copy path', Copy],
        ['reveal', 'Open in explorer', FolderSearch],
      ].map(([action, label, Icon]) => (
        <DropdownMenuItem
          key={action}
          icon={<Icon size={14} />}
          role="menuitem"
          disabled={action === 'open' ? !onOpen : !onAction}
          onClick={() => {
            setMenu(null);
            targetRef.current?.focus();
            if (action === 'open') onOpen(menu.reference);
            else void onAction(action, menu.reference);
          }}
        >
          {label}
        </DropdownMenuItem>
      ))}
    </DropdownMenu>,
    document.body,
  )];
}
