import type { MaterialSnapshot } from "./fold-profile";

export const MATERIAL_PRESET_SCHEMA_VERSION = 1 as const;
export const MATERIAL_PRESET_STORAGE_KEY = "fold-web:material-presets:v1";

export type MaterialPreset = MaterialSnapshot & {
  createdAt: string;
  updatedAt: string;
};

export type MaterialPresetDocument = {
  schemaVersion: typeof MATERIAL_PRESET_SCHEMA_VERSION;
  presets: MaterialPreset[];
};

const preset = (
  id: string,
  name: string,
  thickness: number,
  elongation: MaterialSnapshot["elongation"],
): MaterialPreset => ({
  id,
  name,
  thickness,
  insideBendRadius: thickness,
  cutAngle: 135,
  elongation,
  cutDepth: { "v-cut": 0.5, "a-cut": 0.5, "no-cut": 0 },
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
});

export const DEFAULT_MATERIAL_PRESETS: MaterialPreset[] = [
  preset("al-1t", "알루미늄 1T", 1, { "v-cut": 0.6, "a-cut": 0.4, "no-cut": 1 }),
  preset("al-2t", "알루미늄 2T", 2, { "v-cut": 1.2, "a-cut": 0.8, "no-cut": 2 }),
  preset("al-3t", "알루미늄 3T", 3, { "v-cut": 1.8, "a-cut": 1.2, "no-cut": 3 }),
];

export const materialFromPreset = (value: MaterialPreset): MaterialSnapshot => ({
  id: value.id,
  name: value.name,
  thickness: value.thickness,
  insideBendRadius: value.insideBendRadius,
  cutAngle: value.cutAngle,
  elongation: { ...value.elongation },
  cutDepth: { ...value.cutDepth },
});
