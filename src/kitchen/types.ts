/** Pure deterministic gameplay data. Positions are tile units; x right, y down. */
export const HZ = 60;
export const RULES_VERSION = 'mcd-three-shifts-2' as const;
export type LevelId = 'first-shift' | 'lunch-line' | 'night-relay';
export type OrderChannel = 'dine-in' | 'takeaway';
export type AssistTarget = { type: 'item' | 'station' | 'order'; id: string };
export interface AssistInstruction { id: number; target: AssistTarget; status: 'received' | 'waiting' | 'executing' | 'completed' | 'cancelled' | 'failed'; message: string; issuedAt: number; updatedAt: number }
export type ActorId = 'player' | 'a' | 'b';
export type Role = 'auto' | 'hot' | 'assembly' | 'drinks';
export type Dish = 'burger' | 'cheeseburger' | 'fries' | 'nuggets' | 'cola';
export type ItemKind = 'bun' | 'rawPatty' | 'patty' | 'cheese' | 'potato' | 'cutPotato' | 'rawChicken' | 'cutChicken' | 'cup' | Dish | 'assembly' | 'tray' | 'burnt';
export interface Point { x: number; y: number }
export type ItemLocation = { type: 'hand'; actorId: ActorId } | { type: 'station'; stationId: string } | { type: 'tray'; trayId: string } | { type: 'ground'; x: number; y: number } | { type: 'air'; x: number; y: number; height: number; vx: number; vy: number; vz: number };
export interface KitchenItem {
  id: string; kind: ItemKind; ingredients: ItemKind[]; contents: string[]; location: ItemLocation;
  createdBy: ActorId; lastHandledBy: ActorId; handledBy: ActorId[];
  conveyorJourney?: { id: string; entryIndex: number; steps: number };
}
export type StationKind = 'supply' | 'counter' | 'chop' | 'grill' | 'fryer' | 'drink' | 'traySupply' | 'bin' | 'serve';
export interface StationDefinition extends Point {
  id: string; kind: StationKind; label: string; ports: Point[]; supply?: ItemKind; zone: 'cold' | 'hot' | 'handoff' | 'assembly' | 'drinks' | 'serve';
  channel?: OrderChannel; conveyorId?: string; conveyorIndex?: number;
}
export interface KitchenStation extends StationDefinition {
  itemId: string | null; progress: number; duration: number; burnProgress: number; burnDuration: number;
  state: 'idle' | 'working' | 'cooking' | 'ready' | 'burnt'; workerId: ActorId | null;
}
export interface KitchenActor extends Point {
  id: ActorId; name: string; facing: Point; heldId: string | null; role: Role;
  state: 'idle' | 'moving' | 'carrying' | 'working' | 'waiting'; job: string;
  targetStationId: string | null; workProgress: number; stamina: number; dash: boolean;
  assist: AssistInstruction | null; completedActions: number; deliveries: number; trafficWait: number; throwCharge: number;
}
export interface KitchenOrder {
  id: string; dishes: Dish[]; channel?: OrderChannel; waveId?: string; arrival: number; due: number; status: 'forecast' | 'active' | 'late' | 'served' | 'missed';
  servedAt: number | null; servedBy: ActorId | null; points: number;
}
export interface KitchenMetrics {
  served: number; onTime: number; missed: number; mistakes: number; score: number; combo: number; bestCombo: number;
  handoffs: number; burnt: number; averageWait: number | null; contributions: Record<ActorId, number>;
}
export interface KitchenEvent {
  seq: number; tick: number; type: 'pickup' | 'place' | 'work' | 'ready' | 'burnt' | 'assemble' | 'handoff' | 'throw' | 'catch' | 'serve' | 'reject' | 'order' | 'phase' | 'role' | 'priority' | 'tutorial' | 'assist' | 'conveyor' | 'wave';
  actorId?: ActorId; stationId?: string; itemId?: string; orderId?: string; message: string;
}
export interface TutorialState { stage: 'burger' | 'handoff' | 'combo' | 'conveyor' | 'windows'; step: number; total: number; title: string; text: string; targetStationId: string | null }
export interface KitchenSnapshot {
  rulesVersion: typeof RULES_VERSION; levelId: LevelId; seed: number; tick: number; serviceTick: number;
  phase: 'tutorial' | 'prep' | 'service' | 'closing' | 'results'; phaseRemaining: number;
  actors: KitchenActor[]; items: KitchenItem[]; stations: KitchenStation[]; orders: KitchenOrder[];
  metrics: KitchenMetrics; priorityOrderId: string | null; tutorial: TutorialState | null;
  hint: string; events: KitchenEvent[];
  wave: { id: string; label: string; startsIn: number; channel?: OrderChannel } | null;
  mechanicProgress: { conveyorTransfers: number; playerConveyorLoads: number; playerConveyorRetrievals: number; correctWindowServes: number; assistsCompleted: number };
  shiftRating: ShiftRating | null;
}
export interface InteractionPreview {
  stationId: string | null; itemId: string | null; position: Point; label: string; workLabel: string;
  action: 'take' | 'put' | 'combine' | 'serve' | 'discard' | 'unpack' | 'none'; valid: boolean; reason: string;
}
export interface KitchenGuide { title: string; text: string; stationId: string | null; position: Point | null }
export type KitchenCommand =
  | { type: 'move'; x: number; y: number }
  | { type: 'interact' }
  | { type: 'work'; held: boolean }
  | { type: 'dash'; held: boolean }
  | { type: 'throw'; held: boolean; cancel?: boolean }
  | { type: 'role'; actorId: 'a' | 'b'; role: Role }
  | { type: 'priority'; orderId: string | null }
  | { type: 'assist'; actorId: 'a' | 'b'; target: AssistTarget }
  | { type: 'assist-cancel'; actorId: 'a' | 'b' }
  | { type: 'tutorial-skip' };
export interface KitchenOptions {
  levelId?: LevelId; seed?: number; tutorial?: boolean; ai?: boolean; prepSeconds?: number; serviceSeconds?: number; closingSeconds?: number;
  /** Explicit deterministic test/challenge fixture; no item or actor injection. Times are seconds after opening. */
  orders?: { dishes: Dish[]; arrival: number; due: number; channel?: OrderChannel }[];
}

export interface ConveyorDefinition { id: string; stationIds: readonly string[]; ticksPerStep: number; direction: 'east' | 'west' | 'north' | 'south' }
export interface OrderWave { id: string; label: string; arrival: number; spacing: number; patience: number; channel?: OrderChannel; templates: readonly (readonly Dish[])[] }
export interface LevelDefinition {
  id: LevelId; name: string; subtitle: string; width: number; height: number;
  stations: readonly StationDefinition[]; solidTiles: readonly Point[]; spawns: Readonly<Record<ActorId, Point>>;
  menu: readonly Dish[]; waves: readonly OrderWave[]; conveyors: readonly ConveyorDefinition[];
  timeOfDay: 'morning' | 'noon' | 'night'; prepSeconds: number; serviceSeconds: number; closingSeconds: number;
  mechanic: 'handoff' | 'conveyor' | 'windows';
}
export interface ShiftRating { stars: 0 | 1 | 2 | 3; totalOrders: number; completionRate: number; onTimeRate: number; late: number; missed: number; mistakes: number; burnt: number; reasons: string[]; nextStar: string | null }
export type DeepReadonly<T> = T extends (...args: never[]) => unknown ? T : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type ReadonlyKitchenSnapshot = DeepReadonly<KitchenSnapshot>;
