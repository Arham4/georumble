import type { MapPack } from "../../../shared/mappack";
import { PACK_MANIFEST, type PackDescriptor } from "../../../shared/pack-manifest";

export type { PackDescriptor, PackGroup } from "../../../shared/pack-manifest";
export { PACK_MANIFEST };

export type LoadedPack = {
  descriptor: PackDescriptor;
  pack: MapPack;
  topo: unknown;
};

type TopoShape = {
  objects: Record<string, { type: string; geometries?: unknown[] }>;
};

export class PackStore {
  private readonly inflight = new Map<string, Promise<LoadedPack>>();
  private readonly settled = new Map<string, LoadedPack>();
  private readonly counts = new Map<string, Promise<number>>();

  byId(packId: string): PackDescriptor | null {
    return PACK_MANIFEST.find((p) => p.packId === packId) ?? null;
  }

  cached(packId: string): LoadedPack | null {
    return this.settled.get(packId) ?? null;
  }

  /**
   * Region count for picker decoration. The mappack manifest is a few KB,
   * while a full load drags every topology (MBs, kept forever) into memory
   * for packs the lobby visitor may never play.
   */
  count(packId: string): Promise<number> {
    const existing = this.counts.get(packId);
    if (existing) {
      return existing;
    }
    const descriptor = this.byId(packId);
    if (!descriptor) {
      return Promise.reject(new Error(`Unknown pack: ${packId}`));
    }
    const pending = fetchJson<MapPack>(descriptor.mappackUrl)
      .then((pack) => pack.features.length)
      .catch((error) => {
        this.counts.delete(packId);
        throw error;
      });
    this.counts.set(packId, pending);
    return pending;
  }

  load(packId: string): Promise<LoadedPack> {
    const existing = this.inflight.get(packId);
    if (existing) {
      return existing;
    }
    const descriptor = this.byId(packId);
    if (!descriptor) {
      return Promise.reject(new Error(`Unknown pack: ${packId}`));
    }
    const pending = this.fetchPack(descriptor)
      .then((loaded) => {
        this.settled.set(packId, loaded);
        this.inflight.delete(packId);
        return loaded;
      })
      .catch((error) => {
        // A cached rejection would turn one transient blip into "this pack
        // never loads again" for the whole session; forget and let the next
        // call retry fresh.
        this.inflight.delete(packId);
        throw error;
      });
    this.inflight.set(packId, pending);
    return pending;
  }

  private async fetchPack(descriptor: PackDescriptor): Promise<LoadedPack> {
    const [pack, topo] = await Promise.all([
      fetchJson<MapPack>(descriptor.mappackUrl),
      fetchJson<unknown>(descriptor.topoUrl),
    ]);
    if (pack.packId !== descriptor.packId || pack.features.length === 0) {
      throw new Error(`Mappack ${descriptor.mappackUrl} violates the contract`);
    }
    assertHasGeometry(topo);
    return { descriptor, pack, topo };
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} → HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function assertHasGeometry(topo: unknown): void {
  const shape = topo as Partial<TopoShape> | null;
  if (
    !shape ||
    typeof shape.objects !== "object" ||
    shape.objects === null ||
    Object.keys(shape.objects).length === 0
  ) {
    throw new Error("Topology file has no objects");
  }
}
