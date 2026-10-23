import { Box3, Group, Mesh, Object3D, Texture, Vector3, type Material } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

export interface AssetRecord {
  url: string;
  kind?: string;
  name?: string;
  bounds?: { min: [number, number, number]; max: [number, number, number] };
  grip?: { node: string; position: [number, number, number] };
  rig?: Record<string, string>;
  animations?: string[];
  source?: string;
  license?: string;
}
interface AssetManifest { version: number; assets: Record<string, AssetRecord> }
export interface AssetProgress { loaded: number; total: number; label: string }
export interface ModelFit { width?: number; depth?: number; height?: number; rotation?: number }

/** All render resources belong to one scene. Missing shipped models are a visible
 * loading error; they never silently turn into geometry and start a timed run. */
export class KitchenAssets {
  private loaded = new Map<string, GLTF>();
  private manifest: AssetManifest | null = null;
  private disposed = false;
  private loadEpoch = 0;
  private manifestRequest: AbortController | null = null;
  private released = new WeakSet<GLTF>();

  async load(ids: readonly string[], progress: (state: AssetProgress) => void) {
    if (this.disposed) return;
    this.manifestRequest?.abort(); this.release();
    const epoch = ++this.loadEpoch, request = new AbortController();
    this.manifestRequest = request;
    let failed = false;
    const active = () => !this.disposed && !failed && epoch === this.loadEpoch;
    try {
      const response = await fetch('/assets/original/manifest.json', { signal: request.signal });
      if (!active()) return;
      if (!response.ok) throw new Error('厨房模型清单未能加载（manifest.json）');
      const manifest = await response.json() as AssetManifest;
      if (!active()) return;
      if (!manifest.assets || typeof manifest.assets !== 'object') throw new Error('厨房模型清单格式不正确');
      this.manifest = manifest;
      const unique = [...new Set(ids)];
      const missing = unique.filter(id => !manifest.assets[id]?.url);
      if (missing.length) throw new Error('缺少厨房模型：' + missing.join('、'));
      let done = 0;
      const loader = new GLTFLoader();
      const byUrl = new Map<string, Promise<GLTF>>();
      progress({ loaded: 0, total: unique.length, label: '准备厨房模型' });
      await Promise.all(unique.map(async id => {
        const record = manifest.assets[id];
        let pending = byUrl.get(record.url);
        if (!pending) { pending = loader.loadAsync(record.url); byUrl.set(record.url, pending); }
        let gltf: GLTF;
        try { gltf = await pending; }
        catch { throw new Error('模型加载失败：' + (record.name || id)); }
        // Other requests may finish after the first rejection or scene disposal.
        // They own resources, but no longer own this scene's loading state.
        if (!active()) { this.releaseModels([gltf]); return; }
        this.loaded.set(id, gltf);
        gltf.scene.traverse(node => {
          if (node instanceof Mesh) { node.castShadow = true; node.receiveShadow = true; }
        });
        progress({ loaded: ++done, total: unique.length, label: record.name || id });
      }));
    } catch (error) {
      if (active()) { failed = true; this.release(); throw error; }
    } finally {
      if (epoch === this.loadEpoch) this.manifestRequest = null;
    }
  }

  model(id: string, fit: ModelFit = {}): Group {
    const gltf = this.loaded.get(id);
    if (!gltf) throw new Error('模型未就绪：' + id);
    const root = new Group();
    root.name = id;
    const object = clone(gltf.scene);
    if (fit.rotation) object.rotation.y = fit.rotation;
    object.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(object), size = bounds.getSize(new Vector3());
    const scales = [fit.width === undefined ? Infinity : fit.width / Math.max(size.x, .001), fit.depth === undefined ? Infinity : fit.depth / Math.max(size.z, .001), fit.height === undefined ? Infinity : fit.height / Math.max(size.y, .001)];
    const scale = Math.min(...scales);
    object.scale.multiplyScalar(Number.isFinite(scale) ? scale : 1);
    object.updateMatrixWorld(true);
    bounds.setFromObject(object);
    const center = bounds.getCenter(new Vector3());
    object.position.x -= center.x; object.position.y -= bounds.min.y; object.position.z -= center.z;
    root.add(object);
    root.userData.asset = id;
    return root;
  }

  clips(id: string) { return this.loaded.get(id)?.animations ?? []; }
  record(id: string) { return this.manifest?.assets[id]; }
  inventory() { return [...this.loaded.keys()]; }

  dispose() { this.disposed = true; this.loadEpoch++; this.manifestRequest?.abort(); this.manifestRequest = null; this.release(); }
  private release() {
    this.releaseModels(this.loaded.values());
    this.loaded.clear(); this.manifest = null;
  }
  private releaseModels(models: Iterable<GLTF>) {
    const geometry = new Set<{ dispose(): void }>(), materials = new Set<Material>(), textures = new Set<Texture>();
    for (const gltf of new Set(models)) {
      if (this.released.has(gltf)) continue;
      this.released.add(gltf);
      gltf.scene.traverse((node: Object3D) => {
        if (!(node instanceof Mesh)) return;
        geometry.add(node.geometry);
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          materials.add(material);
          for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
        }
      });
    }
    for (const item of geometry) item.dispose();
    for (const item of materials) item.dispose();
    for (const item of textures) { item.dispose(); const source = item.source.data; if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close(); }
  }
}
