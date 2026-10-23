import { HEIGHT, SOLID_TILES, SPAWNS, STATIONS, WIDTH } from './map';
import { HZ, type LevelDefinition, type LevelId, type StationDefinition } from './types';

const shared = { width: WIDTH, height: HEIGHT, solidTiles: SOLID_TILES, spawns: SPAWNS, prepSeconds: 20, closingSeconds: 40 };
const firstStations: StationDefinition[] = STATIONS.map(s => s.id === 'cheese' || s.id === 'chicken' ? { ...s, kind: 'counter', supply: undefined, label: '备料台' } : { ...s });
const lunchStations: StationDefinition[] = STATIONS.map(s => s.id.startsWith('pass-n') ? { ...s, label: `传餐带 ${Number(s.id.at(-1)) + 1}`, conveyorId: 'hot-to-pack', conveyorIndex: Number(s.id.at(-1)) } : { ...s });
const nightStations: StationDefinition[] = STATIONS.map(s => s.id === 'serve-a' ? { ...s, x: 4, label: '堂食窗口', channel: 'dine-in', ports: [{ x: 4, y: 8 }] } : s.id === 'serve-b' ? { ...s, x: 12, label: '外带窗口', channel: 'takeaway', ports: [{ x: 12, y: 8 }] } : { ...s });

export const LEVELS: readonly LevelDefinition[] = [
  { ...shared, id: 'first-shift', name: '开门第一班 · 传餐台', subtitle: '做好一半，交给合适的人', stations: firstStations, menu: ['burger', 'fries', 'cola'], timeOfDay: 'morning', serviceSeconds: 180, mechanic: 'handoff', conveyors: [], waves: [
    { id: 'opening', label: '第一批客人', arrival: 0, spacing: 15, patience: 65, templates: [['burger'], ['fries'], ['cola'], ['burger', 'fries']] },
    { id: 'lunch', label: '一起配好套餐', arrival: 72, spacing: 14, patience: 58, templates: [['burger', 'cola'], ['fries', 'cola'], ['burger', 'fries', 'cola']] },
    { id: 'last-call', label: '收尾小高峰', arrival: 132, spacing: 12, patience: 50, templates: [['burger', 'fries'], ['cola'], ['burger', 'fries', 'cola']] },
  ] },
  { ...shared, id: 'lunch-line', name: '套餐高峰 · 传餐线', subtitle: '三条生产线，一起准时完成', stations: lunchStations, menu: ['burger', 'cheeseburger', 'fries', 'nuggets', 'cola'], timeOfDay: 'noon', serviceSeconds: 240, mechanic: 'conveyor', conveyors: [{ id: 'hot-to-pack', stationIds: ['pass-n0', 'pass-n1', 'pass-n2', 'pass-n3'], ticksPerStep: Math.round(1.5 * HZ), direction: 'east' }], waves: [
    { id: 'warmup', label: '传餐线开动', arrival: 0, spacing: 12, patience: 66, templates: [['cheeseburger'], ['nuggets'], ['fries', 'cola'], ['burger', 'fries']] },
    { id: 'combo-rush', label: '套餐集中到单', arrival: 68, spacing: 6, patience: 64, templates: [['cheeseburger', 'fries', 'cola'], ['nuggets', 'cola'], ['burger', 'fries', 'cola'], ['nuggets', 'fries']] },
    { id: 'fryer-rush', label: '炸物高峰', arrival: 140, spacing: 8, patience: 58, templates: [['nuggets', 'fries'], ['burger', 'cola'], ['cheeseburger', 'fries'], ['nuggets', 'cola']] },
    { id: 'last-combos', label: '最后一轮套餐', arrival: 204, spacing: 6, patience: 48, templates: [['burger', 'fries', 'cola'], ['cheeseburger', 'cola'], ['nuggets', 'fries', 'cola']] },
  ] },
  { ...shared, id: 'night-relay', name: '夜班接力 · 双窗口', subtitle: '看准高峰，把伙伴派到需要的地方', stations: nightStations, menu: ['burger', 'cheeseburger', 'fries', 'nuggets', 'cola'], timeOfDay: 'night', serviceSeconds: 240, mechanic: 'windows', conveyors: [], waves: [
    { id: 'dine-in-start', label: '堂食客人入座', arrival: 0, spacing: 10, patience: 64, channel: 'dine-in', templates: [['burger'], ['fries', 'cola'], ['cheeseburger', 'fries'], ['nuggets', 'cola']] },
    { id: 'takeaway-peak', label: '外带高峰即将到来', arrival: 66, spacing: 7, patience: 63, channel: 'takeaway', templates: [['burger', 'fries', 'cola'], ['nuggets', 'fries'], ['cheeseburger', 'cola'], ['burger', 'fries']] },
    { id: 'dine-in-return', label: '堂食窗口再接力', arrival: 132, spacing: 7, patience: 58, channel: 'dine-in', templates: [['cheeseburger', 'fries', 'cola'], ['nuggets', 'cola'], ['burger', 'fries'], ['nuggets', 'fries']] },
    { id: 'takeaway-last', label: '夜班最后一波外带', arrival: 198, spacing: 6, patience: 52, channel: 'takeaway', templates: [['burger', 'fries', 'cola'], ['cheeseburger', 'cola'], ['nuggets', 'fries', 'cola'], ['burger', 'cola']] },
  ] },
];
export function getLevel(id: LevelId = 'first-shift'): LevelDefinition {
  const level = LEVELS.find(level => level.id === id);
  if (!level) throw new Error('Unknown kitchen level: ' + String(id));
  return level;
}
