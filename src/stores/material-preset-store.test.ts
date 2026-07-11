import { describe, expect, it } from "vitest";

import { MATERIAL_PRESET_STORAGE_KEY } from "../domain/material-preset";
import { MaterialPresetStore, type PresetStorage } from "./material-preset-store";

class MemoryStorage implements PresetStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("MaterialPresetStore", () => {
  it("seeds versioned default presets on first use", () => {
    const storage = new MemoryStorage();
    const store = new MaterialPresetStore();
    store.hydrate(storage);

    expect(store.presets).toHaveLength(3);
    expect(JSON.parse(storage.getItem(MATERIAL_PRESET_STORAGE_KEY)!)).toMatchObject({ schemaVersion: 1 });
  });

  it("persists manual material changes with stable ids", () => {
    const storage = new MemoryStorage();
    const store = new MaterialPresetStore();
    store.hydrate(storage);
    const material = { ...store.presets[1], name: "현장 알루미늄", thickness: 2.2 };
    store.save(material);

    const restored = new MaterialPresetStore();
    restored.hydrate(storage);
    expect(restored.presets.find((preset) => preset.id === material.id)).toMatchObject({
      name: "현장 알루미늄",
      thickness: 2.2,
    });
  });
});

