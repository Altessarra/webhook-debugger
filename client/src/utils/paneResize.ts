export function clampPaneWidth(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function resizePaneWidth(
  startWidth: number,
  deltaX: number,
  min: number,
  max: number,
) {
  return clampPaneWidth(startWidth + deltaX, min, max);
}
