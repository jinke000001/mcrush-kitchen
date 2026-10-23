import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { KitchenAssets } from './assets';

function pending<T>() {
  let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function model() {
  const scene = new Group(), geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  scene.add(new Mesh(geometry, material));
  return { gltf: { scene, scenes: [scene], animations: [], cameras: [], asset: { version: '2.0' }, userData: {}, parser: {} } as unknown as GLTF, dispose: vi.spyOn(geometry, 'dispose') };
}
function manifest(assets: Record<string, { url: string }>) {
  return { ok: true, json: async () => ({ version: 1, assets }) } as Response;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('kitchen model loading lifecycle', () => {
  it('freezes progress after one failure and releases shared late results once', async () => {
    const slow = pending<GLTF>(), broken = pending<GLTF>(), late = model();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(manifest({ bad: { url: '/bad' }, a: { url: '/slow' }, b: { url: '/slow' } })));
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(url => url === '/bad' ? broken.promise : slow.promise);
    const assets = new KitchenAssets(), progress = vi.fn();
    const loading = assets.load(['bad', 'a', 'b'], progress);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    broken.reject(new Error('404'));
    await expect(loading).rejects.toThrow('模型加载失败：bad');
    const callsAtFailure = progress.mock.calls.length;
    slow.resolve(late.gltf); await slow.promise; await Promise.resolve();
    expect(progress).toHaveBeenCalledTimes(callsAtFailure);
    expect(assets.inventory()).toEqual([]);
    expect(late.dispose).toHaveBeenCalledTimes(1);
    assets.dispose();
    expect(late.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not load models or report progress when a disposed manifest arrives', async () => {
    const response = pending<Response>();
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(response.promise));
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync');
    const assets = new KitchenAssets(), progress = vi.fn(), loading = assets.load(['a'], progress);
    assets.dispose(); response.resolve(manifest({ a: { url: '/a' } })); await loading;
    expect(loader).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });

  it('keeps the new load intact when an earlier model finishes later', async () => {
    const old = pending<GLTF>(), oldModel = model(), currentModel = model();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(manifest({ a: { url: '/a' } })));
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementationOnce(() => old.promise).mockResolvedValueOnce(currentModel.gltf);
    const assets = new KitchenAssets(), oldProgress = vi.fn(), newProgress = vi.fn();
    const oldLoad = assets.load(['a'], oldProgress);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    await assets.load(['a'], newProgress);
    old.resolve(oldModel.gltf); await oldLoad;
    expect(oldProgress).toHaveBeenCalledTimes(1);
    expect(newProgress).toHaveBeenLastCalledWith({ loaded: 1, total: 1, label: 'a' });
    expect(assets.inventory()).toEqual(['a']);
    expect(oldModel.dispose).toHaveBeenCalledTimes(1);
    expect(currentModel.dispose).not.toHaveBeenCalled();
    assets.dispose(); expect(currentModel.dispose).toHaveBeenCalledTimes(1);
  });
});
