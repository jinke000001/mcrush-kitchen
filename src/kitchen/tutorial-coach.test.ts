import { describe, expect, it } from 'vitest';
import type { InteractionPreview, KitchenGuide, TutorialState } from './types';
import { resolvePlayerPrompt, tutorialCommandMode } from './tutorial-coach';

const lesson = (stage: TutorialState['stage'], title = ''): TutorialState => ({ stage, step: 1, total: 3, title, text: '', targetStationId: null });
const guide = (patch: Partial<KitchenGuide>): KitchenGuide => ({ title: '去拿生肉饼', text: '肉饼架在发光。走过去，面向它按 E。', stationId: 'meat', position: { x: 3.5, y: 1.5 }, ...patch });
const preview = (patch: Partial<InteractionPreview>): InteractionPreview => ({ stationId: null, itemId: null, position: { x: 0, y: 0 }, label: '', workLabel: '', action: 'none', valid: false, reason: '', ...patch });
const DROP = /放下|放在地上|放在这里|先把手里/;

describe('first-shift tutorial prompts', () => {
  it('does not tell an empty-handed player to drop, even if a stale hint says so', () => {
    const prompt = resolvePlayerPrompt({
      tutorial: lesson('burger'),
      held: false,
      preview: preview({ label: '空台面 · 把物品放在这里', reason: '空台面 · 把物品放在这里' }),
      guide: guide({}),
      hint: '先把手里的物品放下',
    });
    expect(prompt.action).toBe('去拿生肉饼');
    expect(prompt.corner).not.toMatch(DROP);
    expect(prompt.action).not.toMatch(DROP);
    expect(tutorialCommandMode(lesson('burger'), prompt.action)).toBe('locked');
  });

  it('uses one phrase while holding, and never the floor drop', () => {
    const goal = guide({ title: '把面包放到台面', text: '把面包放到发光的空台面上，面向它按 E。', stationId: 'pass-n0' });
    const away = resolvePlayerPrompt({
      tutorial: lesson('burger'),
      held: true,
      preview: preview({ label: '放在地上', action: 'put', valid: true, reason: '' }),
      guide: goal,
      hint: '靠近空台面放下',
    });
    expect(away.action).toBe(away.corner);
    expect(away.action).toBe('把面包放到台面');
    expect(away.action).not.toContain('放在地上');

    const atCounter = resolvePlayerPrompt({
      tutorial: lesson('burger'),
      held: true,
      preview: preview({ stationId: 'pass-n0', label: '放下面包', action: 'put', valid: true }),
      guide: goal,
      hint: '靠近空台面放下',
    });
    expect(atCounter.action).toBe('放下面包');
    expect(atCounter.corner).toBe(atCounter.action);
    expect(atCounter.key).toBe('E');
  });

  it('keeps a real pickup prompt when a stale drop hint is left over outside the lesson', () => {
    const prompt = resolvePlayerPrompt({
      tutorial: null,
      held: false,
      preview: preview({ stationId: 'bun', label: '拿面包', action: 'take', valid: true }),
      guide: guide({ title: '去拿面包', stationId: 'bun' }),
      hint: '先把手里的物品放下',
    });
    expect(prompt.action).toBe('拿面包');
    expect(prompt.corner).toBe('去拿面包');
    expect(prompt.corner).not.toMatch(DROP);
  });
  it('opens only the continue key once the lesson is teaching the handoff', () => {
    expect(tutorialCommandMode(lesson('handoff', '2 · 把准备工作交给队友'), '交给队友接力')).toBe('locked');
    expect(tutorialCommandMode(lesson('handoff'), '现在指挥一次接力')).toBe('continue');
    expect(tutorialCommandMode(null, '现在指挥一次接力')).toBe('full');
  });
});
