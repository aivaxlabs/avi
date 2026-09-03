import { forwardRef } from 'react';
import { classNames } from '../lib/format.js';

export const DropdownMenu = forwardRef(function DropdownMenu({ children, className, style, fixed = false, ...props }, ref) {
  return (
    <div
      ref={ref}
      {...props}
      className={classNames('dropdown-menu', fixed && 'fixed', className)}
      style={style}
    >
      {children}
    </div>
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
