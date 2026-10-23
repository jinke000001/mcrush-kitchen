import {
  ACESFilmicToneMapping, AmbientLight, Box3, BoxGeometry, BufferGeometry, CanvasTexture, Color, DirectionalLight,
  DoubleSide, EdgesGeometry, ExtrudeGeometry, Group, HemisphereLight, InstancedMesh, Line, LineBasicMaterial, LineSegments, Matrix4,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, OrthographicCamera, PCFShadowMap, PlaneGeometry,
  PMREMGenerator, Raycaster, RingGeometry, Scene, Shape, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace, Vector3,
  WebGLRenderer, WebGLRenderTarget, type Material, type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildDecor } from './decor';
import type { Quality, VisualPreferences } from './preferences';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { getLevel } from '../kitchen/levels';
import { HZ, type ActorId, type ItemKind, type KitchenItem, type ReadonlyKitchenSnapshot, type DeepReadonly, type LevelDefinition, type KitchenStation } from '../kitchen/types';
import { ITEM_NAMES } from '../kitchen/recipes';
import { THROW_GRAVITY, throwVelocity } from '../kitchen/rules';
import { KitchenAssets } from './assets';
import { ChefAnimation } from './actor-animation';
import { KitchenSession } from './session';

const CREW_COLORS: Record<ActorId, number> = { player: 0x48a8ed, a: 0xef6559, b: 0x55b786 };
const FOOD_ASSET: Partial<Record<ItemKind, string>> = {
  bun: 'bun', rawPatty: 'patty-raw', patty: 'patty', cheese: 'cheese', potato: 'potato', cutPotato: 'potato-cut',
  rawChicken: 'chicken-raw', cutChicken: 'chicken-cut', fries: 'fries', nuggets: 'nuggets', cup: 'cup', cola: 'cola', tray: 'tray', burnt: 'burnt',
};
const REQUIRED_ASSETS = [
  'counter', 'counter-flat', 'griddle', 'pan', 'fryer', 'fryer-basket', 'board', 'serve', 'bin', 'crate', 'plate', 'tray', 'drink-machine',
  ...Object.values(FOOD_ASSET), 'bun-base', 'bun-lid', 'chef-player', 'chef-a', 'chef-b',
];
interface StationDrawing { node: Group; top: number; label: HTMLDivElement; bar: HTMLDivElement; fill: HTMLSpanElement; caption: HTMLSpanElement; steam: Sprite[] }
interface ItemDrawing { node: Group; signature: string }

export class KitchenScene3D {
  private renderer: WebGLRenderer | null = null;
  private scene = new Scene();
  private camera = new OrthographicCamera(-10, 10, 6, -6, .1, 100);
  private assets = new KitchenAssets();
  private objects = new Group();
  private stations = new Map<string, StationDrawing>();
  private actors = new Map<ActorId, ChefAnimation>();
  private actorLabels = new Map<ActorId, HTMLDivElement>();
  private rings = new Map<ActorId, Mesh>();
  private items = new Map<string, ItemDrawing>();
  private target = new Group();
  private targetPort: Mesh;
  private guideMark: Mesh;
  private resources = new Set<{ dispose(): void }>();
  private disposed = false;
  private observer: ResizeObserver | null = null;
  private labels!: HTMLDivElement;
  private host!: HTMLElement;
  private lastTick = -1;
  private level: LevelDefinition = getLevel();
  private preferences: VisualPreferences = {quality:"balanced",reducedEffects:false,labels:true};
  private viewportWidth=1; private viewportHeight=1; private projection=new Vector3();
  private materials = new Map<string,MeshStandardMaterial>();
  private geometryCache = new Map<string,BufferGeometry>();
  private keyLight: DirectionalLight | null=null; private customers:Group[]=[];
  private beltMarkers:Mesh[]=[];
  private popup!: HTMLDivElement;
  private modelTops = new Map<string, number>();
  private packages = new Map<string, Group>();
  private throwArc: Line | null = null;

  constructor() {
    const ring = new RingGeometry(.32, .4, 48), targetMat = new MeshBasicMaterial({ color: 0xffd34f, transparent: true, opacity: .8, side: DoubleSide, depthWrite: false });
    this.targetPort = new Mesh(ring, targetMat); this.targetPort.rotation.x = -Math.PI / 2;
    this.guideMark = new Mesh(this.track(new RingGeometry(.29, .36, 48)), this.track(new MeshBasicMaterial({ color: 0xffcd4a, transparent: true, opacity: .85, side: DoubleSide, depthWrite: false })));
    this.guideMark.rotation.x = -Math.PI / 2;
    this.track(ring); this.track(targetMat);
  }
  private track<T extends { dispose(): void }>(resource: T): T { this.resources.add(resource); return resource; }
  private material(color: number, metalness = 0, roughness = .7) { const key=`${color}:${metalness}:${roughness}`;let m=this.materials.get(key);if(!m){m=this.track(new MeshStandardMaterial({ color, roughness, metalness }));this.materials.set(key,m);}return m; }
  private box(width: number, height: number, depth: number, material: Material, radius = .04) {
    const key=[width,height,depth,radius].join(','); let geometry=this.geometryCache.get(key);if(!geometry){geometry=this.track(radius ? new RoundedBoxGeometry(width, height, depth, 1, radius) : new BoxGeometry(width, height, depth));this.geometryCache.set(key,geometry);}
    const mesh = new Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
  }
  private surfaceHeight(object: Object3D) {
    object.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(object);
    const ray = new Raycaster(new Vector3(0, bounds.max.y + 1, 0), new Vector3(0, -1, 0));
    return ray.intersectObject(object, true)[0]?.point.y ?? bounds.max.y;
  }

  async mount(host: HTMLElement, session: KitchenSession) {
    if (this.disposed) return;
    session.beginLoading();
    this.host = host; this.level=session.engine.level;this.preferences=session.getView().preferences;
    this.labels = document.createElement('div'); this.labels.className = 'world-labels'; this.labels.setAttribute('aria-hidden', 'true');
    this.popup = document.createElement('div'); this.popup.className = 'serve-popup'; this.labels.appendChild(this.popup);
    try {
      this.renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(this.pixelRatio(this.preferences.quality));
      this.renderer.outputColorSpace = SRGBColorSpace; this.renderer.toneMapping = ACESFilmicToneMapping; this.renderer.toneMappingExposure = .98;
      this.renderer.shadowMap.enabled = this.preferences.quality !== 'performance'; this.renderer.shadowMap.type = PCFShadowMap;
      this.renderer.domElement.setAttribute('aria-label', '可操作的立体厨房'); this.renderer.domElement.setAttribute('role', 'img');
      host.append(this.renderer.domElement, this.labels);
      await this.assets.load(REQUIRED_ASSETS, progress => { if (!this.disposed) session.setLoading(progress); });
      if (this.disposed) return;
      this.buildEnvironment(); this.buildStations();
      this.customers=buildDecor(this.scene,this.level,{box:(...args)=>this.box(...args),material:(...args)=>this.material(...args),sign:(...args)=>this.sign(...args),track:r=>this.track(r)});
      this.batchStatic(); this.buildActors(session.engine.readSnapshot());
      this.scene.add(this.objects, this.targetPort, this.guideMark, this.target);
      this.resize();
      session.setLoading({ loaded: REQUIRED_ASSETS.length, total: REQUIRED_ASSETS.length, label: '点亮厨房' });
      session.setIcons(Object.fromEntries(Object.keys(ITEM_NAMES).map(kind=>[kind,'/assets/original/icons/'+kind+'.svg'])));
      const warmup = new Group(); warmup.position.y = -50;
      for (const kind of Object.keys(ITEM_NAMES) as ItemKind[]) warmup.add(this.food({ kind, ingredients: [], contents: [] }));
      this.scene.add(warmup); await this.renderer.compileAsync(this.scene, this.camera); this.scene.remove(warmup);
      if (this.disposed) return;
      this.render(session);
      session.attachRenderer(() => this.render(session), () => this.diagnostics());
      this.observer = new ResizeObserver(() => { if (!this.disposed) { this.resize(); this.render(session); } });
      this.observer.observe(host); session.setReady();
    } catch (error) {
      if (!this.disposed) { session.setError(error instanceof Error ? error.message : '立体厨房未能初始化'); console.error(error); }
    }
  }

  private buildEnvironment() {
    const {width:WIDTH,height:HEIGHT,solidTiles:SOLID_TILES}=this.level;
    const night=this.level.timeOfDay==='night';
    this.scene.background = new Color(night?0x303f4e:this.level.timeOfDay==='noon'?0xe6d5b9:0xe4c9a6);
    const ambient = new HemisphereLight(night?0xb2d7ec:0xfff7e6, night?0x374351:0x9b7458, night?1.0:1.25); this.scene.add(ambient);
    const key = new DirectionalLight(night?0xffd79d:0xfff3dc, night?2.1:this.level.timeOfDay==='noon'?2.7:2.5);this.keyLight=key; key.position.set(2, 14, 4); key.target.position.set(8, 0, 5);
    key.castShadow = true; const shadowSize=this.preferences.quality==='high'?2048:1024;key.shadow.mapSize.set(shadowSize,shadowSize); key.shadow.camera.left = -12; key.shadow.camera.right = 12;
    key.shadow.camera.top = 11; key.shadow.camera.bottom = -11; key.shadow.camera.near = 1; key.shadow.camera.far = 40;
    key.shadow.bias = -.0002; key.shadow.normalBias = .025; key.shadow.radius = 3;
    this.scene.add(key, key.target);
    const pmrem = new PMREMGenerator(this.renderer!); const room = new RoomEnvironment(); const environment = pmrem.fromScene(room, .04);
    this.scene.environment = environment.texture; this.scene.environmentIntensity = .45;
    this.track(environment); room.dispose(); pmrem.dispose();

    const floorEdge = this.box(WIDTH + .35, .5, HEIGHT + .35, this.material(0xc69261), .2); floorEdge.position.set(WIDTH / 2, -.3, HEIGHT / 2); this.scene.add(floorEdge);
    const grout = this.box(WIDTH, .08, HEIGHT, this.material(0xb49b81), .02); grout.position.set(WIDTH / 2, -.035, HEIGHT / 2); this.scene.add(grout);
    const tileGeometry = this.track(new RoundedBoxGeometry(.982, .035, .982, 1, .012));
    const tiles = [new InstancedMesh(tileGeometry, this.material(0xf0e6d5), WIDTH * HEIGHT), new InstancedMesh(tileGeometry, this.material(0xdcdccf), WIDTH * HEIGHT)];
    const counts = [0, 0], matrix = new Matrix4();
    for (let z = 0; z < HEIGHT; z++) for (let x = 0; x < WIDTH; x++) { const color = (x + z) % 2; matrix.makeTranslation(x + .5, .015, z + .5); tiles[color].setMatrixAt(counts[color]++, matrix); }
    tiles.forEach((tile, i) => { tile.count = counts[i]; tile.receiveShadow = true; this.scene.add(tile); });
    const cream = this.material(0xf4e7cb), red = this.material(0xbe3c2d), gold = this.material(0xe8b54a, .1, .55);
    const back = this.box(WIDTH, 1.75, .35, cream); back.position.set(8, .875, .25); this.scene.add(back);
    const stripe = this.box(WIDTH, .25, .37, red, .01); stripe.position.set(8, 1.48, .25); this.scene.add(stripe);
    const left = this.box(.35, .5, HEIGHT - .5, cream), right = left.clone(); left.position.set(.25, .25, 5.6); right.position.set(WIDTH - .25, .25, 5.6); this.scene.add(left, right);
    const front = this.box(WIDTH, .16, .22, gold); front.position.set(8, .08, HEIGHT - .2); this.scene.add(front);
    const pickupFront = this.box(4.6, .62, .22, red, .035); pickupFront.position.set(8.5, .31, HEIGHT - .48); this.scene.add(pickupFront);
    const pickupCap = this.box(4.7, .065, .3, gold, .02); pickupCap.position.set(8.5, .65, HEIGHT - .48); this.scene.add(pickupCap);
    const pickupSign = this.sign('M  ·  取餐', '#ffe2a0', '#be3c2d', 640, 160); pickupSign.scale.set(1.65, .4, 1); pickupSign.position.set(8.5, .34, HEIGHT - .36); this.scene.add(pickupSign);
    const sign = this.sign('McRush', '#fff6e6', '#b62e25', 1024, 256); sign.scale.set(3.1, .78, 1); sign.position.set(10.4, .94, .46); this.scene.add(sign);
    const banner = this.sign('麦 门 厨 房', '#b8472c', '#fff0c7', 768, 180); banner.scale.set(2.15, .5, 1); banner.position.set(4.2, 1.12, .46); this.scene.add(banner);
    // Solid island center is present in the actual collision map.
    for (const tile of SOLID_TILES.filter(p => p.x > 0 && p.x < WIDTH - 1 && p.y > 0 && p.y < HEIGHT - 1)) {
      const counter = this.assets.model('counter-flat', { width: .99, depth: .99, height: .84 });
      const h = new Box3().setFromObject(counter).max.y, pedestal = Math.max(0, .78 - h);
      const base = this.box(.99, pedestal, .99, this.material(0xf3e7cf)); base.position.set(tile.x + .5, pedestal / 2, tile.y + .5); this.scene.add(base);
      counter.position.set(tile.x + .5, pedestal, tile.y + .5); this.scene.add(counter);
    }
    const menu = this.sign('COOK • PASS • TOGETHER', '#fff2cf', '#344a3d', 1024, 160); menu.scale.set(3.5, .55, 1); menu.position.set(4.4, 1.33, .48); this.scene.add(menu);
    const arcGeometry = this.track(new BufferGeometry().setFromPoints(Array.from({ length: 25 }, () => new Vector3())));
    this.throwArc = new Line(arcGeometry, this.track(new LineBasicMaterial({ color: 0xffc84b, transparent: true, opacity: .9, depthTest: false }))); this.throwArc.renderOrder = 4; this.throwArc.visible = false; this.scene.add(this.throwArc);
  }
  private sign(text: string, color: string, background: string, width = 512, height = 128) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `800 ${height * .58}px system-ui, sans-serif`; ctx.fillText(text, width / 2, height / 2, width * .9);
    const texture = this.track(new CanvasTexture(canvas)); texture.colorSpace = SRGBColorSpace;
    return new Mesh(this.track(new PlaneGeometry(1, 1)), this.track(new MeshBasicMaterial({ map: texture, side: DoubleSide })));
  }

  private buildStations() {
    const red = this.material(0xbc4535), cabinet = this.material(0xf4e5c9, .1, .55), rail = this.material(0xdda947, .2, .4);
    for (const station of this.level.stations) {
      const node = new Group(); node.position.set(station.x + .5, 0, station.y + .5);
      const port = station.ports[0], angle = Math.atan2(port.x - station.x, port.y - station.y);
      let base: Group;
      if (station.kind === 'grill') base = this.assets.model('griddle', { width: .98, depth: .98, height: 1 });
      else if (station.kind === 'fryer') base = this.assets.model('fryer', { width: .98, depth: .98, height: 1 });
      else if (station.kind === 'bin') base = this.assets.model('bin', { width: .78, depth: .78, height: .86 });
      else if (station.kind === 'serve') base = this.assets.model('serve', { width: .99, depth: .99, height: .9 });
      else base = this.assets.model(station.kind === 'counter' ? 'counter-flat' : 'counter', { width: .99, depth: .99, height: .84 });
      base.rotation.y = angle;
      const baseBounds = new Box3().setFromObject(base);
      const baseSurface = ['bin', 'serve', 'fryer'].includes(station.kind) ? baseBounds.max.y : this.surfaceHeight(base);
      const pedestal = station.kind === 'bin' ? 0 : Math.max(0, .78 - baseSurface);
      node.add(base);
      if (pedestal > .005) {
        base.position.y = pedestal;
        const body = this.box(.96, pedestal, .96, cabinet, .025); body.position.y = pedestal / 2; node.add(body);
        const facing = new Group(); facing.rotation.y = angle;
        const front = this.box(.86, Math.max(.06, pedestal - .035), .025, station.zone === 'handoff' ? cabinet : red, .01); front.position.set(0, pedestal / 2, .485); facing.add(front);
        const handle = this.box(.3, .025, .035, rail, .008); handle.position.set(0, Math.max(.05, pedestal - .07), .51); facing.add(handle); node.add(facing);
      }
      const top = baseSurface + pedestal;
      let surface = top;
      this.modelTops.set(station.id, top);
      if (station.kind === 'chop') { const board = this.assets.model('board', { width: .74, depth: .67, height: .12 }); board.rotation.y = angle; surface += this.surfaceHeight(board); board.position.y = top; node.add(board); }
      if (station.kind === 'grill') { const pan = this.assets.model('pan', { width: .87, depth: .85, height: .17 }); pan.rotation.y = angle; surface += this.surfaceHeight(pan); pan.position.y = top; node.add(pan); }
      if (station.kind === 'fryer') { const basket = this.assets.model('fryer-basket', { width: .7, depth: .74, height: .24 }); basket.position.y = top - .09; basket.rotation.y = angle; surface = top - .055; node.add(basket); }
      if (station.kind === 'supply') {
        const crate = this.assets.model('crate', { width: .81, depth: .72 });
        crate.position.y = top; crate.rotation.y = angle; node.add(crate);
        const key = FOOD_ASSET[station.supply!];
        if (key) for (let i = 0; i < 3; i++) { const food = this.assets.model(key, { width: .31, depth: .31, height: .3 }); food.position.set((i - 1) * .19, top + .19, (i % 2 ? .1 : -.08)); food.rotation.y = i * .35; node.add(food); }
      }
      if (station.kind === 'traySupply') for (let i = 0; i < 3; i++) { const tray = this.assets.model('tray', { width: .75, depth: .7, height: .12 }); tray.position.y = top + i * .055; node.add(tray); }
      if (station.kind === 'drink') {
        const machine = this.assets.model('drink-machine', { width: .73, depth: .64, height: 1.3 });
        machine.position.set(-(port.x - station.x) * .12, top, -(port.y - station.y) * .12); machine.rotation.y = angle; node.add(machine);
      }
      if (station.zone === 'handoff' || station.zone === 'assembly') { const edgeGroup = new Group(); edgeGroup.rotation.y = angle; const edge = this.box(.82, .05, .035, station.zone === 'handoff' ? rail : red, .008); edge.position.set(0, top - .04, .49); edgeGroup.add(edge); node.add(edgeGroup); }
      if(station.conveyorId) {
        const belt=this.box(.96,.045,.88,this.material(0x355b5d),.01);belt.position.y=top+.025;node.add(belt);surface=top+.05;
        for(const z of [-.4,.4]) {const guard=this.box(.99,.065,.035,rail,.007);guard.position.set(0,top+.04,z);node.add(guard);}
        const arrow=this.sign('»','#f5c65f','#355b5d',128,128);arrow.rotation.x=-Math.PI/2;arrow.scale.set(.27,.35,1);arrow.position.set(station.x+.5,top+.052,station.y+.5);this.scene.add(arrow);this.beltMarkers.push(arrow);
      }
      this.scene.add(node);
      const label = document.createElement('div'); label.className = 'station-label';
      const caption = document.createElement('span'); caption.className = 'station-caption'; caption.textContent = station.label;
      const bar = document.createElement('div'); bar.className = 'device-progress'; const fill = document.createElement('span'); bar.append(fill); label.append(caption, bar); this.labels.append(label);
      const steam = (['grill','fryer','drink'].includes(station.kind)?[0,1,2]:[]).map(() => { const sprite = new Sprite(this.track(new SpriteMaterial({ map: this.steamTexture(), transparent: true, opacity: 0, depthWrite: false, color: 0xfff4e4 }))); this.scene.add(sprite); return sprite; });
      this.stations.set(station.id, { node, top: surface, label, caption, bar, fill, steam });
    }
    const edges = new LineSegments(this.track(new EdgesGeometry(new BoxGeometry(.99, .12, .99))), this.track(new LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: .9 })));
    this.target.add(edges); this.target.visible = false;
  }
  private puffTexture: Texture | null = null;
  private steamTexture() {
    if (this.puffTexture) return this.puffTexture;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64; const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32); gradient.addColorStop(0, '#ffffffdc'); gradient.addColorStop(1, '#ffffff00'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
    return this.puffTexture = this.track(new CanvasTexture(canvas));
  }

  private buildActors(w: ReadonlyKitchenSnapshot) {
    for (const actor of w.actors) {
      const id = 'chef-' + actor.id, model = this.assets.model(id, { height: 1.48, width: 1.1, depth: 1.1, rotation: 0 });
      const animator = new ChefAnimation(model, this.assets.record(id)); this.actors.set(actor.id, animator); this.scene.add(animator.root);
      const ring = new Mesh(this.track(new RingGeometry(.29, .37, 48)), this.track(new MeshBasicMaterial({ color: CREW_COLORS[actor.id], side: DoubleSide, transparent: true, opacity: .95, depthWrite: false })));
      ring.rotation.x = -Math.PI / 2; ring.position.y = .05; this.scene.add(ring); this.rings.set(actor.id, ring);
      const label = document.createElement('div'); label.className = 'actor-label actor-' + actor.id; this.actorLabels.set(actor.id, label); this.labels.append(label);
    }
  }

  private food(item: DeepReadonly<Pick<KitchenItem, 'kind' | 'ingredients' | 'contents'>>, all: readonly DeepReadonly<KitchenItem>[] = [], inFryer = false): Group {
    const group = new Group();
    if (item.kind === 'burger' || item.kind === 'cheeseburger' || item.kind === 'assembly') {
      const parts = item.ingredients.length ? item.ingredients : item.kind === 'cheeseburger' ? ['bun', 'patty', 'cheese'] : ['bun', 'patty'];
      let y = 0;
      if (parts.includes('bun')) { const bottom = this.assets.model('bun-base', { width: .54, depth: .54 }); group.add(bottom); y = new Box3().setFromObject(bottom).max.y; }
      for (const part of ['patty', 'cheese'] as const) if (parts.includes(part)) {
        const mesh = this.assets.model(FOOD_ASSET[part]!, { width: .52, depth: .52 });

        const h = new Box3().setFromObject(mesh).max.y; mesh.position.y = y; group.add(mesh); y += h * .95;
      }
      if (parts.includes('bun')) { const lid = this.assets.model('bun-lid', { width: .55, depth: .55, height: .22 }); lid.position.y = y; group.add(lid); }
    } else if (item.kind === 'tray') {
      const tray = this.assets.model('tray', { width: .88, depth: .76, height: .1 }); group.add(tray);
      for (let i = 0; i < item.contents.length; i++) {
        const child = all.find(candidate => candidate.id === item.contents[i]); if (!child) continue;
        const food = this.food(child, all); food.scale.setScalar(.68); food.position.set((i % 2 ? 1 : -1) * .2, .06, (Math.floor(i / 2) - .5) * .28); group.add(food);
      }
    } else if (item.kind === 'fries' || item.kind === 'nuggets') {
      if (!inFryer) group.add(this.package(item.kind));
      const food = this.assets.model(FOOD_ASSET[item.kind]!, { width: item.kind === 'fries' ? .45 : .51, depth: item.kind === 'fries' ? .28 : .34, height: item.kind === 'fries' ? .42 : .15 });
      food.position.y = inFryer ? 0 : item.kind === 'fries' ? .12 : .055; group.add(food);
    } else {
      const id = FOOD_ASSET[item.kind];
      if (!id) throw new Error('没有对应的餐品模型：' + item.kind);
      const drink = item.kind === 'cup' || item.kind === 'cola';
      const food = this.assets.model(id, { width: drink ? .34 : .55, depth: drink ? .34 : .55, height: drink ? .59 : .32 });

      group.add(food);
    }
    return group;
  }
  private package(kind: 'fries' | 'nuggets') {
    const cached = this.packages.get(kind); if (cached) return cached.clone(true);
    const group = new Group(), red = this.material(0xbf3527, 0, .75), cream = this.material(0xffefcc), gold = this.material(0xf4c349);
    if (kind === 'fries') {
      const frontShape = new Shape(); frontShape.moveTo(-.19, 0); frontShape.lineTo(.19, 0); frontShape.lineTo(.26, .29); frontShape.quadraticCurveTo(0, .16, -.26, .29); frontShape.closePath();
      const face = new Mesh(this.track(new ExtrudeGeometry(frontShape, { depth: .015, bevelEnabled: true, bevelSize: .008, bevelThickness: .005, bevelSegments: 1, steps: 1 })), red); face.position.z = .14; group.add(face);
      const back = this.box(.5, .32, .018, red, .008); back.position.set(0, .16, -.14); group.add(back);
      for (const sign of [-1, 1]) { const side = this.box(.02, .26, .28, red, .006); side.position.set(sign * .225, .13, 0); side.rotation.z = -sign * .13; group.add(side); }
      const bottom = this.box(.4, .02, .28, cream, .005); bottom.position.y = .015; group.add(bottom);
      const mark = this.sign('M', '#ffd34e', '#bf3527', 128, 128); mark.scale.set(.17, .15, 1); mark.position.set(0, .115, .164); group.add(mark);
    } else {
      const bottom = this.box(.59, .035, .44, cream, .015); bottom.position.y = .02; group.add(bottom);
      for (const sign of [-1, 1]) { const side = this.box(.025, .12, .44, red, .008); side.position.set(sign * .29, .07, 0); group.add(side); }
      const front = this.box(.59, .12, .025, red, .008); front.position.set(0, .07, .215); group.add(front);
      const lid = new Group(); lid.position.set(0, .04, -.22); lid.rotation.x = -.9;
      const panel = this.box(.59, .025, .42, cream, .012); panel.position.z = -.21; lid.add(panel);
      const brand = this.sign('M', '#b53624', '#fff0ce', 128, 128); brand.rotation.x = -Math.PI / 2; brand.scale.set(.17, .16, 1); brand.position.set(0, .015, -.23); lid.add(brand); group.add(lid);
    }
    group.traverse(node => { if (node instanceof Mesh) { node.castShadow = true; node.receiveShadow = true; } });
    this.packages.set(kind, group); return group.clone(true);
  }
  private batchStatic() {
    this.scene.updateMatrixWorld(true);
    const batches=new Map<string,{material:Material;geometries:BufferGeometry[]}>();
    const movable=new Set<Object3D>([...this.customers,...this.beltMarkers]);
    const meshes:Mesh[]=[];
    this.scene.traverse(object=>{ if(!(object instanceof Mesh)||object instanceof InstancedMesh||Array.isArray(object.material))return;
      let p:Object3D|null=object;while(p){if(movable.has(p))return;p=p.parent;}
      if(!(object.material instanceof MeshStandardMaterial))return;
      meshes.push(object);
    });
    for(const mesh of meshes) {
      const material=mesh.material as MeshStandardMaterial;
      const key=[material.color.getHex(),material.metalness,material.roughness,material.map?.uuid??'',material.transparent,material.opacity].join(':');
      const bucket=batches.get(key)??{material,geometries:[]};let geometry=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      if(geometry.index){const old=geometry;geometry=geometry.toNonIndexed();old.dispose();}
      // Exported models may lack UVs when untextured; static batches don't use them.
      if(!material.map)geometry.deleteAttribute('uv');
      geometry.deleteAttribute('tangent');bucket.geometries.push(geometry);batches.set(key,bucket);mesh.removeFromParent();
    }
    for(const bucket of batches.values()) {
      const geometry=mergeGeometries(bucket.geometries);bucket.geometries.forEach(g=>g.dispose());
      if(!geometry)throw new Error('原创场景合批失败');
      const mesh=new Mesh(this.track(geometry),bucket.material);mesh.receiveShadow=true;mesh.castShadow=false;this.scene.add(mesh);
    }
  }
  private pixelRatio(quality:Quality) { return Math.min(window.devicePixelRatio||1,quality==='high'?1.5:quality==='balanced'?1.25:1); }
  private applyPreferences(next:VisualPreferences) {
    if(next.quality!==this.preferences.quality&&this.renderer){
      this.renderer.setPixelRatio(this.pixelRatio(next.quality));this.renderer.shadowMap.enabled=next.quality!=='performance';
      if(this.keyLight){const size=next.quality==='high'?2048:1024;this.keyLight.shadow.mapSize.set(size,size);this.keyLight.shadow.map?.dispose();this.keyLight.shadow.map=null;}
      this.resize();
    }
    this.preferences=next;
  }
  private resize() {
    if (!this.renderer) return;
    const width = this.viewportWidth=Math.max(1, this.host.clientWidth), height = this.viewportHeight=Math.max(1, this.host.clientHeight); this.renderer.setSize(width, height, false);
    const aspect = width / height, halfHeight = Math.max(5.7, 8.7 / aspect), halfWidth = halfHeight * aspect;
    this.camera.left = -halfWidth; this.camera.right = halfWidth; this.camera.top = halfHeight; this.camera.bottom = -halfHeight;
    this.camera.position.set(11, 16, 20); this.camera.lookAt(8, .12, 5.3); this.camera.updateProjectionMatrix();
  }
  private project(element: HTMLElement, x: number, y: number, z: number) {
    const vector = this.projection.set(x,y,z).project(this.camera);
    element.style.transform = `translate(-50%, -100%) translate(${(vector.x * .5 + .5) * this.viewportWidth}px, ${(-vector.y * .5 + .5) * this.viewportHeight}px)`;
  }
  private render(session: KitchenSession) {
    if (this.disposed || !this.renderer) return;
    if(session.engine.level.id!==this.level.id)return;
    this.applyPreferences(session.getView().preferences);
    const w = session.engine.readSnapshot(), seconds = w.tick / HZ, delta = this.lastTick < 0 ? 0 : Math.max(0, (w.tick - this.lastTick) / HZ); this.lastTick = w.tick;
    const menu = session.getView().screen === 'title'; this.labels.classList.toggle('preview-labels', menu);this.labels.classList.toggle('labels-minimal',!this.preferences.labels);
    for(let i=0;i<this.customers.length;i++){const customer=this.customers[i];customer.position.x=4+i*6+Math.sin(seconds*.11+i)*1.2;customer.position.y=this.preferences.reducedEffects?0:Math.abs(Math.sin(seconds*5+i))*.015;}

    for (const actor of w.actors) {
      const animation = this.actors.get(actor.id)!;
      const moving = delta > 0 && Math.hypot(actor.x - animation.root.position.x, actor.y - animation.root.position.z) > .0001;
      animation.update({ x: actor.x, z: actor.y, dx: actor.facing.x, dz: actor.facing.y, moving, working: actor.state === 'working', carrying: !!actor.heldId, dashing: actor.dash, time: seconds, delta, reducedMotion:this.preferences.reducedEffects, acknowledge:actor.assist?.status==='received', action: w.stations.find(station => station.id === actor.targetStationId)?.kind });
      this.rings.get(actor.id)!.position.set(actor.x, .055, actor.y);
      const label = this.actorLabels.get(actor.id)!; label.textContent = actor.id === 'player' ? '你' : actor.name;
      if (actor.state === 'working') label.textContent += ' · 加工中'; else if (actor.trafficWait > 30) label.textContent += ' · 让行';
      this.project(label, actor.x, 1.72, actor.y);
    }
    for (const station of w.stations) this.updateStation(station, seconds);
    const alive = new Set<string>();
    for (const item of w.items) {
      if (item.location.type === 'tray') continue;
      alive.add(item.id);
      const location = item.location;
      const station = location.type === 'station' ? w.stations.find(s => s.id === location.stationId) : undefined;
      const inFryer = station?.kind === 'fryer';
      const signature = [item.kind, inFryer, item.ingredients.join(','), item.contents.map(id => { const i = w.items.find(i => i.id === id); return id + ':' + i?.kind; }).join(',')].join('|');
      let drawing = this.items.get(item.id);
      if (!drawing || drawing.signature !== signature) { drawing?.node.removeFromParent(); drawing = { node: this.food(item, w.items, inFryer), signature }; this.items.set(item.id, drawing); }
      const object = drawing.node;
      if (location.type === 'hand') { const holder = this.actors.get(location.actorId)!.hold; if (object.parent !== holder) holder.add(object); object.position.set(0, 0, 0); object.rotation.set(0, 0, 0); }
      else {
        if (object.parent !== this.objects) this.objects.add(object);
        if (location.type === 'station' && station) { const port = station.ports[0], offset = station.kind === 'drink' ? .3 : 0; object.position.set(station.x + .5 + (port.x - station.x) * offset, this.stations.get(station.id)!.top + .008, station.y + .5 + (port.y - station.y) * offset); object.rotation.set(0, .2, 0); }
        else if (location.type === 'ground' || location.type === 'air') { object.position.set(location.x, location.type === 'air' ? location.height : .05, location.y); object.rotation.y = location.type === 'air' ? seconds * 5 : .3; }
      }
    }
    for (const [id, drawing] of this.items) if (!alive.has(id)) { drawing.node.removeFromParent(); this.items.delete(id); }
    const preview = session.engine.getInteractionPreview(), guide = session.engine.getGuide();
    const player = w.actors[0];
    if (this.throwArc) {
      this.throwArc.visible = !menu && player.throwCharge > 0 && !!player.heldId;
      if (this.throwArc.visible) {
        const velocity = throwVelocity(player.throwCharge), position = this.throwArc.geometry.getAttribute('position');
        const flight = (velocity.vertical + Math.sqrt(velocity.vertical ** 2 + 2 * THROW_GRAVITY * velocity.height)) / THROW_GRAVITY;
        for (let i = 0; i < position.count; i++) { const t = i / (position.count - 1) * flight; position.setXYZ(i, player.x + player.facing.x * (.5 + velocity.speed * t), velocity.height + velocity.vertical * t - .5 * THROW_GRAVITY * t * t + .06, player.y + player.facing.y * (.5 + velocity.speed * t)); }
        position.needsUpdate = true; this.throwArc.geometry.computeBoundingSphere();
      }
    }
    this.target.visible = !menu && !!preview?.stationId; this.targetPort.visible = false;
    if (preview?.stationId && !menu) {
      const station = w.stations.find(s => s.id === preview.stationId)!; this.target.position.set(station.x + .5, this.stations.get(station.id)!.top + .04, station.y + .5);
      const material = (this.target.children[0] as LineSegments).material as LineBasicMaterial; material.color.set(preview.valid ? 0xffeda5 : 0xe7774e);
    }
    this.guideMark.visible = !menu && !!w.tutorial && !!guide.stationId;
    if (this.guideMark.visible && guide.stationId) { const station = w.stations.find(s => s.id === guide.stationId)!; const p = station.ports[0]; this.guideMark.position.set(p.x + .5, .06, p.y + .5); this.guideMark.scale.setScalar(1 + Math.sin(seconds * 4) * .08); }
    const event = [...w.events].reverse().find(event => event.type === 'serve' || event.type === 'reject' || event.type === 'burnt');
    const age = event ? (w.tick - event.tick) / HZ : 10;
    this.popup.hidden = !event || age > 2 || menu;
    if (event && age < 2) { this.popup.textContent = event.message; this.popup.className = 'serve-popup ' + (event.type === 'serve' ? 'success' : 'warning'); this.project(this.popup, 8.5, 1.5 + age * .3, 8.8); this.popup.style.opacity = String(Math.min(1, 2 - age)); }
    this.renderer.render(this.scene, this.camera);
  }
  private updateStation(station: DeepReadonly<KitchenStation>, seconds: number) {
    const draw = this.stations.get(station.id)!;
    const machine = ['grill', 'fryer', 'drink'].includes(station.kind), active = station.state !== 'idle';
    draw.label.className = 'station-label state-' + station.state + (station.zone === 'handoff' ? ' is-handoff' : '');
    draw.caption.textContent = station.state === 'ready' ? '✓ 可以取走' : station.state === 'burnt' ? '焦了 · 拿去回收' : station.state === 'cooking' ? station.label + ' ' + Math.ceil((station.duration - station.progress) / HZ) + 's' : station.label;
    draw.label.hidden = station.zone === 'handoff' && !active || station.zone === 'assembly' && station.kind === 'counter' && !active;
    draw.bar.hidden = !['working', 'cooking', 'ready'].includes(station.state);
    const percent = station.state === 'ready' ? 1 - station.burnProgress / Math.max(1, station.burnDuration) : station.progress / Math.max(1, station.duration);
    draw.fill.style.width = Math.max(0, Math.min(100, percent * 100)) + '%';
    this.project(draw.label, station.x + .5, draw.top + (station.kind === 'drink' ? 1.55 : station.kind === 'supply' ? .85 : .62), station.y + .5);
    draw.steam.forEach((puff, i) => { const rise = (seconds * .65 + i / 3) % 1; puff.visible = !this.preferences.reducedEffects && this.preferences.quality!=='performance' && machine && (station.state === 'cooking' || station.state === 'ready' || station.state === 'burnt'); puff.position.set(station.x + .5 + Math.sin(seconds + i) * .12, draw.top + .15 + rise * .8, station.y + .5); puff.scale.setScalar(.2 + rise * .4); const material = puff.material as SpriteMaterial; material.opacity = (1 - rise) * .4; material.color.set(station.state === 'burnt' ? 0x433b33 : 0xfff6df); });
  }
  diagnostics() { return { assets: this.assets.inventory(), drawCalls: this.renderer?.info.render.calls ?? 0, triangles: this.renderer?.info.render.triangles ?? 0, geometries: this.renderer?.info.memory.geometries ?? 0, textures: this.renderer?.info.memory.textures ?? 0, programs:this.renderer?.info.programs?.length??0, map: this.level.id, quality:this.preferences.quality }; }
  destroy(session: KitchenSession) {
    this.disposed = true; session.attachRenderer(null); this.observer?.disconnect();
    for (const actor of this.actors.values()) actor.dispose();
    this.assets.dispose(); for (const resource of this.resources) resource.dispose(); this.resources.clear();
    this.renderer?.dispose(); this.renderer?.domElement.remove(); this.labels?.remove(); this.scene.clear();
  }
}
