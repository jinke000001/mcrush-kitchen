import { HZ, type Dish, type ItemKind, type KitchenItem, type Role } from './types';
export const ITEM_NAMES: Record<ItemKind, string> = {
  bun: '面包', rawPatty: '生肉饼', patty: '熟肉饼', cheese: '芝士', potato: '土豆', cutPotato: '切好的薯条',
  rawChicken: '鸡肉', cutChicken: '裹好的鸡块', cup: '空纸杯', burger: '经典牛肉堡', cheeseburger: '芝士牛肉堡',
  fries: '薯条', nuggets: '鸡块', cola: '可乐', assembly: '待完成的汉堡', tray: '套餐餐盒', burnt: '焦糊食物',
};
export const DISH_NAMES: Record<Dish, string> = { burger: '经典牛肉堡', cheeseburger: '芝士牛肉堡', fries: '薯条', nuggets: '鸡块', cola: '可乐' };
export const ROLE_NAMES: Record<Role, string> = { auto: '灵活补位', hot: '煎炸主厨', assembly: '配餐出餐', drinks: '饮料支援' };
export const DISH_INGREDIENTS: Record<Dish, readonly ItemKind[]> = {
  burger: ['bun', 'patty'], cheeseburger: ['bun', 'patty', 'cheese'], fries: ['cutPotato'], nuggets: ['cutChicken'], cola: ['cup'],
};
export const PROCESS: Partial<Record<ItemKind, { station: 'chop' | 'grill' | 'fryer' | 'drink'; output: ItemKind; ticks: number; burnTicks: number }>> = {
  potato: { station: 'chop', output: 'cutPotato', ticks: 2 * HZ, burnTicks: 0 },
  rawChicken: { station: 'chop', output: 'cutChicken', ticks: 3 * HZ, burnTicks: 0 },
  rawPatty: { station: 'grill', output: 'patty', ticks: 7 * HZ, burnTicks: 9 * HZ },
  cutPotato: { station: 'fryer', output: 'fries', ticks: 6 * HZ, burnTicks: 9 * HZ },
  cutChicken: { station: 'fryer', output: 'nuggets', ticks: 8 * HZ, burnTicks: 10 * HZ },
  cup: { station: 'drink', output: 'cola', ticks: 3 * HZ, burnTicks: 0 },
};
export const isDish = (kind: ItemKind): kind is Dish => Object.hasOwn(DISH_NAMES, kind);
export const throwable = (kind: ItemKind) => ['bun', 'rawPatty', 'patty', 'cheese', 'potato', 'cutPotato', 'rawChicken', 'cutChicken'].includes(kind);
export function burgerParts(item: KitchenItem): ItemKind[] | null {
  if (['bun', 'patty', 'cheese'].includes(item.kind)) return [item.kind];
  return ['burger', 'cheeseburger', 'assembly'].includes(item.kind) ? item.ingredients : null;
}
export function combinedBurger(a: KitchenItem, b: KitchenItem): { kind: ItemKind; ingredients: ItemKind[] } | null {
  const x = burgerParts(a), y = burgerParts(b); if (!x || !y) return null;
  const parts = [...x, ...y];
  if (parts.length > 3 || new Set(parts).size !== parts.length || !parts.every(p => ['bun', 'patty', 'cheese'].includes(p))) return null;
  return { kind: parts.includes('bun') && parts.includes('patty') ? parts.includes('cheese') ? 'cheeseburger' : 'burger' : 'assembly', ingredients: ['bun', 'patty', 'cheese'].filter(k => parts.includes(k as ItemKind)) as ItemKind[] };
}
export function sameDishes(a: readonly Dish[], b: readonly Dish[]): boolean { return a.length === b.length && [...a].sort().join(',') === [...b].sort().join(','); }
export function dishSubset(parts: readonly Dish[], order: readonly Dish[]): boolean {
  const remaining = [...order]; for (const dish of parts) { const i = remaining.indexOf(dish); if (i < 0) return false; remaining.splice(i, 1); } return true;
}
