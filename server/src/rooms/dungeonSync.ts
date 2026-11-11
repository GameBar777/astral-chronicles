/** Registry so dungeon service can snap every occupant to a new floor spawn without a circular import. */
type Snap = { snap(mapId: string, x: number, y: number): void };
export const dungeonRoomReg = new Map<string, Snap>();
export function snapDungeonFloor(instanceId: string, mapId: string, x: number, y: number) {
  dungeonRoomReg.get(instanceId)?.snap(mapId, x, y);
}
