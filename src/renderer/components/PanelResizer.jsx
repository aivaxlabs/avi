import { useRef, useState } from 'react';

export function PanelResizer({
  label,
  controls,
  value,
  min,
  max,
  direction,
  cssVariable,
  onChange,
  onCommit,
}) {
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);

  function finishResize(event) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    const { frameId, shell, value: nextValue } = dragRef.current;
    if (frameId !== null) cancelAnimationFrame(frameId);
    shell.style.setProperty(cssVariable, `${nextValue}px`);
    onChange(nextValue);
    onCommit(nextValue);
    dragRef.current = null;
    setDragging(false);
    document.body.classList.remove('panel-resizing');
  }

  return (
    <div
      className={`panel-resizer${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-controls={controls}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value} pixels`}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startValue: value,
          value,
          frameId: null,
          shell: event.currentTarget.closest('.app-shell'),
        };
        setDragging(true);
        document.body.classList.add('panel-resizing');
      }}
      onPointerMove={(event) => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        const nextValue = Math.round(Math.max(
          min,
          Math.min(
            max,
            dragRef.current.startValue
              + (event.clientX - dragRef.current.startX) * direction,
          ),
        ));
        if (nextValue === dragRef.current.value) return;
        dragRef.current.value = nextValue;
        if (dragRef.current.frameId !== null) return;
        dragRef.current.frameId = requestAnimationFrame(() => {
          const drag = dragRef.current;
          if (!drag) return;
          drag.shell.style.setProperty(cssVariable, `${drag.value}px`);
          drag.frameId = null;
        });
      }}
      onPointerUp={finishResize}
      onPointerCancel={finishResize}
      onLostPointerCapture={finishResize}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 48 : 16;
        const nextValue = event.key === 'Home'
          ? min
          : event.key === 'End'
            ? max
            : event.key === 'ArrowLeft'
              ? value - step * direction
              : event.key === 'ArrowRight'
                ? value + step * direction
                : null;
        if (nextValue === null) return;
        event.preventDefault();
        const clampedValue = Math.round(Math.max(min, Math.min(max, nextValue)));
        onChange(clampedValue);
        onCommit(clampedValue);
      }}
    />
  );
}
