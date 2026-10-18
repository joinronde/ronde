// Where a menu opens: on the side of its button it was asked for when it fits there, on the other side when that
// one has more room, and never taller than the room it gets (it scrolls then)

/** Gap between the button and the menu, and the menu and the edge of the screen */
const GAP = 6;
const EDGE = 12;

export function menuPlacement({
  top,
  bottom,
  viewport,
  topInset = 0,
  height,
  preferUp,
}: {
  /** The button's top and bottom, in the viewport */
  top: number;
  bottom: number;
  viewport: number;
  /** What covers the top of the viewport (a sticky top bar) */
  topInset?: number;
  /** The menu's natural height */
  height: number;
  preferUp: boolean;
}): { up: boolean; maxHeight: number } {
  const above = Math.max(0, top - topInset - GAP - EDGE);
  const below = Math.max(0, viewport - bottom - GAP - EDGE);
  const up = preferUp ? height <= above || above >= below : height > below && above > below;
  return { up, maxHeight: Math.floor(up ? above : below) };
}
