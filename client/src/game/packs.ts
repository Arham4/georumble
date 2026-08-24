import type { MapPack } from "../../../shared/mappack";

export type PackDescriptor = {
  packId: string;
  displayName: string;
  blurb: string;
  mappackUrl: string;
  topoUrl: string;
};

/**
 * Adding a future pack means appending an entry here and dropping its two
 * artifacts into assets/mappacks/ — no client code changes.
 */
export const PACK_MANIFEST: PackDescriptor[] = [
  {
    packId: "us-states",
    displayName: "US States",
    blurb: "50 states plus DC on the classic albers map",
    mappackUrl: "/mappacks/us-states.mappack.json",
    topoUrl: "/mappacks/us-states.topojson",
  },
  {
    packId: "europe",
    displayName: "Europe",
    blurb: "39 countries from Portugal to Russia, microstates spared",
    mappackUrl: "/mappacks/europe.mappack.json",
    topoUrl: "/mappacks/europe.topojson",
  },
  {
    packId: "asia",
    displayName: "Asia",
    blurb: "49 countries from the Mediterranean to the Pacific",
    mappackUrl: "/mappacks/asia.mappack.json",
    topoUrl: "/mappacks/asia.topojson",
  },
  {
    packId: "south-america",
    displayName: "South America",
    blurb: "12 countries from the Caribbean coast to Cape Horn",
    mappackUrl: "/mappacks/south-america.mappack.json",
    topoUrl: "/mappacks/south-america.topojson",
  },
];

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

  byId(packId: string): PackDescriptor | null {
    return PACK_MANIFEST.find((p) => p.packId === packId) ?? null;
  }

  cached(packId: string): LoadedPack | null {
    return this.settled.get(packId) ?? null;
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
    const pending = this.fetchPack(descriptor).then((loaded) => {
      this.settled.set(packId, loaded);
      this.inflight.delete(packId);
      return loaded;
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
