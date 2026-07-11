import { makeAutoObservable } from "mobx";

import {
  DEFAULT_MATERIAL_PRESETS,
  MATERIAL_PRESET_SCHEMA_VERSION,
  MATERIAL_PRESET_STORAGE_KEY,
  type MaterialPreset,
  type MaterialPresetDocument,
} from "../domain/material-preset";
import type { MaterialSnapshot } from "../domain/fold-profile";

export type PresetStorage = Pick<Storage, "getItem" | "setItem">;

const clonePresets = (presets: MaterialPreset[]) =>
  JSON.parse(JSON.stringify(presets)) as MaterialPreset[];

const isPresetDocument = (value: unknown): value is MaterialPresetDocument => {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<MaterialPresetDocument>;
  return document.schemaVersion === MATERIAL_PRESET_SCHEMA_VERSION && Array.isArray(document.presets);
};

export class MaterialPresetStore {
  presets: MaterialPreset[] = [];
  hydrated = false;
  storage: PresetStorage | null = null;

  constructor() {
    makeAutoObservable(this, { storage: false }, { autoBind: true });
  }

  hydrate(storage: PresetStorage) {
    if (this.hydrated) return;
    this.storage = storage;
    const raw = storage.getItem(MATERIAL_PRESET_STORAGE_KEY);
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      this.presets = isPresetDocument(parsed)
        ? parsed.presets.map((preset) => ({
            ...preset,
            insideBendRadius: typeof preset.insideBendRadius === "number" ? preset.insideBendRadius : preset.thickness,
          }))
        : clonePresets(DEFAULT_MATERIAL_PRESETS);
    } catch {
      this.presets = clonePresets(DEFAULT_MATERIAL_PRESETS);
    }
    this.hydrated = true;
    this.persist();
  }

  save(material: MaterialSnapshot) {
    const timestamp = new Date().toISOString();
    const existing = this.presets.find((preset) => preset.id === material.id);
    const next: MaterialPreset = {
      ...material,
      elongation: { ...material.elongation },
      cutDepth: { ...material.cutDepth },
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    this.presets = existing
      ? this.presets.map((preset) => preset.id === material.id ? next : preset)
      : [...this.presets, next];
    this.persist();
  }

  private persist() {
    if (!this.storage) return;
    const document: MaterialPresetDocument = {
      schemaVersion: MATERIAL_PRESET_SCHEMA_VERSION,
      presets: this.presets,
    };
    this.storage.setItem(MATERIAL_PRESET_STORAGE_KEY, JSON.stringify(document));
  }
}

export const materialPresetStore = new MaterialPresetStore();
