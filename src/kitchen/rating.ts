import type { DeepReadonly, KitchenSnapshot, ShiftRating } from './types';
/** Ratings describe actual delivery outcomes. They never depend on arbitrary action-count rewards. */
export function evaluateShift(world: DeepReadonly<KitchenSnapshot>): ShiftRating {
  const total = world.orders.length, served = world.orders.filter(o => o.status === 'served').length;
  const onTime = world.orders.filter(o => o.status === 'served' && o.servedAt !== null && o.servedAt <= o.due).length;
  const completionRate = total ? served / total : 0, onTimeRate = total ? onTime / total : 0;
  const late = served - onTime, missed = total - served, { mistakes, burnt } = world.metrics;
  const stars = completionRate >= .95 && onTimeRate >= .9 && mistakes <= 1 && burnt <= 1 ? 3 : completionRate >= .75 && onTimeRate >= .55 ? 2 : completionRate >= .5 ? 1 : 0;
  const reasons = [missed ? `${missed} 单未交付：先救已接单，再备新食材` : '', late ? `${late} 单迟到：提前备料，利用伙伴接力` : '', mistakes ? `${mistakes} 次误交付：核对餐盒和窗口` : '', burnt ? `${burnt} 份焦糊：熟食提示后及时取走` : ''].filter(Boolean);
  if (!reasons.length) reasons.push('全部订单准时交付，厨房接力顺畅');
  return { stars, totalOrders: total, completionRate, onTimeRate, late, missed, mistakes, burnt, reasons, nextStar: stars === 3 ? null : stars === 2 ? '三星：交付至少 95%，准时至少 90%，误交付与焦糊各不超过 1 次' : stars === 1 ? '二星：交付至少 75%，准时至少 55%' : '一星：完成至少一半订单' };
}
