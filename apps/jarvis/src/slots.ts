/** Calcule les créneaux libres d'une journée à partir des événements occupés. */
export interface Busy {
  start: Date;
  end: Date;
}

export interface Slot {
  start: Date;
  end: Date;
  minutes: number;
}

export function freeSlots(busy: Busy[], windowStart: Date, windowEnd: Date, minMinutes = 30): Slot[] {
  const sorted = busy
    .filter((b) => b.end > windowStart && b.start < windowEnd)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const slots: Slot[] = [];
  let cursor = windowStart;
  for (const block of sorted) {
    if (block.start > cursor) pushSlot(slots, cursor, block.start, minMinutes);
    if (block.end > cursor) cursor = block.end;
  }
  if (cursor < windowEnd) pushSlot(slots, cursor, windowEnd, minMinutes);
  return slots;
}

function pushSlot(slots: Slot[], start: Date, end: Date, minMinutes: number): void {
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (minutes >= minMinutes) slots.push({ start, end, minutes });
}
