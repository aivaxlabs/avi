import { useRef, useState } from 'react';

export function PanelResizer({
  label,
  controls,
  value,
  min,
  max,
  direction,
  onChange,
  onCommit,
}) {
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);

  function finishResize(event) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    onCommit(dragRef.current.value);
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
        dragRef.current.value = nextValue;
        onChange(nextValue);
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
