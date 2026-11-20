import {
  closestCorners,
  getFirstCollision,
  KeyboardCode,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";

const DIRECTIONS: string[] = [KeyboardCode.Down, KeyboardCode.Right, KeyboardCode.Up, KeyboardCode.Left];
// The drag preview is slightly rotated, so its box is off by a few pixels.
const TOLERANCE_PX = 10;

/**
 * Arrow keys move the dragged item onto the nearest card or column in that
 * direction. Same idea as dnd-kit's sortableKeyboardCoordinates, with a tolerance.
 */
const keyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  if (!DIRECTIONS.includes(event.code)) return undefined;
  event.preventDefault();
  const { active, collisionRect, droppableRects, droppableContainers, over } = context;
  if (!active || !collisionRect) return undefined;

  // A target lies entirely on that side: the column the item sits in is never "to
  // the left". Up and down stay within the same column.
  const sameColumn = (rect: { left: number; right: number }) =>
    rect.left < collisionRect.right - TOLERANCE_PX && rect.right > collisionRect.left + TOLERANCE_PX;
  const candidates = droppableContainers.getEnabled().filter((entry) => {
    const rect = entry.id !== active.id && droppableRects.get(entry.id);
    if (!rect) return false;
    switch (event.code) {
      case KeyboardCode.Down:
        return sameColumn(rect) && rect.top >= collisionRect.bottom - TOLERANCE_PX;
      case KeyboardCode.Up:
        return sameColumn(rect) && rect.bottom <= collisionRect.top + TOLERANCE_PX;
      case KeyboardCode.Right:
        return rect.left >= collisionRect.right - TOLERANCE_PX;
      default:
        return rect.right <= collisionRect.left + TOLERANCE_PX;
    }
  });
  const collisions = closestCorners({ active, collisionRect, droppableRects, droppableContainers: candidates, pointerCoordinates: null });
  let id = getFirstCollision(collisions, "id");
  if (id === over?.id && collisions.length > 1) id = collisions[1].id;
  const rect = id != null ? droppableRects.get(id) : undefined;
  return rect ? { x: rect.left, y: rect.top } : undefined;
};

/**
 * Mouse and keyboard drag and drop. Mouse: a 5 px move starts a drag, so a plain
 * click still opens or selects. Keyboard: Space picks up, arrows move, Space or
 * Enter drops, Escape cancels; Enter alone stays free to open a card.
 */
export function useDragSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: keyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );
}
