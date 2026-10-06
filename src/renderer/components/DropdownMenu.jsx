import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { classNames } from '../lib/format.js';
import { Overlay } from './Overlay.jsx';

const viewportMargin = 8;

export const DropdownMenu = forwardRef(function DropdownMenu({
  children,
  className,
  style,
  fixed = false,
  submenu = false,
  ...props
}, ref) {
  const menuRef = useRef(null);
  useImperativeHandle(ref, () => menuRef.current, []);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!submenu || !menu?.offsetParent) return undefined;

    const fitToViewport = () => {
      menu.classList.remove('flip-left');
      menu.style.top = '';
      menu.style.maxHeight = '';
      menu.style.overflowY = '';

      const holder = menu.offsetParent.getBoundingClientRect();
      const left = holder.left + menu.offsetLeft;
      menu.classList.toggle('flip-left', left + menu.offsetWidth > window.innerWidth - viewportMargin);

      const availableHeight = window.innerHeight - viewportMargin * 2;
      if (menu.offsetHeight > availableHeight) {
        menu.style.maxHeight = `${availableHeight}px`;
        menu.style.overflowY = 'auto';
      }

      const top = holder.top + menu.offsetTop;
      const overflow = top + menu.offsetHeight - (window.innerHeight - viewportMargin);
      if (overflow > 0) {
        const shift = Math.min(overflow, top - viewportMargin);
        menu.style.top = `${menu.offsetTop - shift}px`;
      }
    };

    fitToViewport();
    window.addEventListener('resize', fitToViewport);
    return () => window.removeEventListener('resize', fitToViewport);
  }, [submenu]);

  return (
    <Overlay
      ref={menuRef}
      {...props}
      className={classNames('dropdown-menu', fixed && 'fixed', className)}
      style={style}
    >
      {children}
    </Overlay>
  );
});

export function DropdownMenuItem({ active = false, children, icon, className, ...props }) {
  return (
    <button
      {...props}
      className={classNames('dropdown-menu-item', !icon && 'no-icon', active && 'active', className)}
      type="button"
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
