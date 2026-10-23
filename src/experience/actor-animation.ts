import { Group, Vector3, type Object3D } from 'three';
import type { AssetRecord } from './assets';
export interface ActorPose {
  x: number; z: number; dx: number; dz: number;
  moving: boolean; working: boolean; carrying: boolean; dashing: boolean;
  time: number; delta: number; action?: string; acknowledge?: boolean; reducedMotion?: boolean;
}
/** Original rigid-joint animation; semantic joint names come from our manifest. */
export class ChefAnimation {
  readonly root = new Group();
  readonly hold = new Group();
  private joints: Record<string, Object3D | undefined> = {};
  private grip?: Object3D;
  private anchor = new Vector3();
  private lastAngle = 0;
  constructor(readonly model: Group, record?: AssetRecord) {
    this.root.add(model, this.hold); this.hold.position.set(0, .7, .4);
    for (const [semantic, name] of Object.entries(record?.rig ?? {})) this.joints[semantic] = model.getObjectByName(name);
    if (record?.grip) this.grip = model.getObjectByName(record.grip.node);
  }
  update(p: ActorPose) {
    if (p.dx || p.dz) this.lastAngle = Math.atan2(p.dx, p.dz);
    const angle = Math.atan2(Math.sin(this.lastAngle - this.root.rotation.y), Math.cos(this.lastAngle - this.root.rotation.y));
    this.root.rotation.y += angle * Math.min(1, p.delta * 20); this.root.position.set(p.x, 0, p.z);
    const stride = p.moving ? Math.sin(p.time * (p.dashing ? 19 : 13)) : 0;
    const work = p.working ? Math.sin(p.time * 15) : 0;
    this.model.position.y = p.reducedMotion ? 0 : p.moving ? Math.abs(stride) * .025 : Math.sin(p.time * 2.5) * .005;
    this.model.rotation.z = p.reducedMotion ? 0 : stride * .018;
    const rotate = (name: string, x = 0, y = 0, z = 0) => this.joints[name]?.rotation.set(x, y, z);
    rotate('leftLeg', stride * .38); rotate('rightLeg', -stride * .38);
    rotate('leftArm', p.carrying ? -.95 : p.working ? -.9 + work * .27 : stride * .32, 0, -.09);
    rotate('rightArm', p.carrying ? -.95 : p.working ? p.action === 'drink' ? -1.2 : -.9 - work * .27 : -stride * .32, 0, .09);
    if (p.acknowledge && !p.carrying && !p.working) rotate('rightArm', -1.6, 0, -.3 + Math.sin(p.time * 14) * .12);
    rotate('head', p.working ? .12 : 0, p.moving ? 0 : Math.sin(p.time * .8) * .045);
    if (this.grip) { this.model.updateMatrixWorld(true); this.grip.getWorldPosition(this.anchor); this.root.worldToLocal(this.anchor); this.hold.position.copy(this.anchor); }
    this.hold.rotation.z = -this.model.rotation.z;
  }
  bones() { return Object.keys(this.joints); }
  dispose() { /* Shared resources belong to KitchenAssets. */ }
}
