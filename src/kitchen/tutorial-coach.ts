import type { InteractionPreview, KitchenGuide, TutorialState } from './types';

/** Floor-drop and empty-hand "put it down" phrases that must not contradict the current action. */
const DROP_URGE = /放下|放在地上|放在这里|先把手里/;

export type CommandMode = 'full' | 'locked' | 'continue';

/**
 * Full partner commands stay hidden until the lesson is actually teaching a handoff.
 * `continue` exposes only "接续" (Q → 1 → E). Everything earlier stays locked.
 */
export function tutorialCommandMode(tutorial: TutorialState | null, guideTitle: string): CommandMode {
  if (!tutorial) return 'full';
  if (tutorial.stage === 'handoff' && (guideTitle === '现在指挥一次接力' || guideTitle === '伙伴先把食物放好' || guideTitle === '伙伴收到你的指令')) return 'continue';
  return 'locked';
}

export interface PlayerPrompt {
  /** Phrase shown in the center. When holding, this is also the corner text. */
  action: string;
  key: 'E' | 'Space' | null;
  corner: string;
  state: 'ready' | 'blocked' | 'walking';
}

const urgesDrop = (text: string) => DROP_URGE.test(text);

function isGroundDrop(preview: InteractionPreview) {
  return preview.action === 'put' && preview.stationId == null;
}

/** A live key prompt only when it is the lesson's station, never a floor drop. */
function aligned(preview: InteractionPreview, guide: KitchenGuide) {
  if (!preview.valid || isGroundDrop(preview)) return false;
  if (!guide.stationId) return true;
  return preview.stationId === guide.stationId;
}

function phrase(preview: InteractionPreview) {
  return preview.workLabel || preview.label;
}

/**
 * One prompt for the center key and the corner status.
 * Empty hands never get a drop/put-down urge. While holding, both surfaces use the same words.
 */
export function resolvePlayerPrompt(options: {
  tutorial: TutorialState | null;
  held: boolean;
  preview: InteractionPreview | null;
  guide: KitchenGuide;
  hint: string;
}): PlayerPrompt {
  const { tutorial, held, preview, guide, hint } = options;
  if (!tutorial) {
    const dropPreview = !!preview && urgesDrop((preview.workLabel || preview.label || preview.reason));
    if (!held && dropPreview) return { action: guide.title, key: null, corner: urgesDrop(hint) ? guide.title : hint, state: 'walking' };
    if (preview) {
      const action = preview.workLabel || (preview.valid ? preview.label : preview.reason);
      return { action, key: preview.workLabel ? 'Space' : 'E', corner: !held && urgesDrop(hint) ? guide.title : hint, state: preview.valid ? 'ready' : 'blocked' };
    }
    return { action: guide.title, key: null, corner: !held && urgesDrop(hint) ? guide.title : hint, state: 'walking' };
  }

  if (!held) {
    if (preview && aligned(preview, guide)) {
      const action = phrase(preview);
      return { action, key: preview.workLabel ? 'Space' : 'E', corner: action, state: 'ready' };
    }
    const corner = urgesDrop(guide.text) ? guide.title : guide.text;
    return { action: guide.title, key: null, corner, state: 'walking' };
  }

  if (preview && aligned(preview, guide)) {
    const action = phrase(preview);
    return { action, key: preview.workLabel ? 'Space' : 'E', corner: action, state: 'ready' };
  }
  return { action: guide.title, key: null, corner: guide.title, state: 'walking' };
}
