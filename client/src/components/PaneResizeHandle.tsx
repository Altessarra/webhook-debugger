import type { KeyboardEventHandler, PointerEventHandler } from "react";

export function PaneResizeHandle({
  label,
  onPointerDown,
  onKeyDown,
}: {
  label: string;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      className="pane-resize-handle"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <span aria-hidden="true" />
    </div>
  );
}
