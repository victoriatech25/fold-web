import { makeAutoObservable } from "mobx";

export type CanvasShape = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  label: string;
};

const palette = ["#2563eb", "#16a34a", "#f97316", "#db2777", "#7c3aed"];

class CanvasStore {
  shapes: CanvasShape[] = [
    {
      id: "shape-1",
      x: 88,
      y: 96,
      width: 150,
      height: 96,
      fill: palette[0],
      label: "MobX",
    },
    {
      id: "shape-2",
      x: 330,
      y: 170,
      width: 170,
      height: 110,
      fill: palette[1],
      label: "Konva",
    },
  ];

  selectedId = "shape-1";
  moveCount = 0;

  constructor() {
    makeAutoObservable(this);
  }

  get selectedShape() {
    return this.shapes.find((shape) => shape.id === this.selectedId);
  }

  selectShape(id: string) {
    this.selectedId = id;
  }

  addShape() {
    const index = this.shapes.length;

    this.shapes.push({
      id: `shape-${Date.now()}`,
      x: 72 + (index % 4) * 112,
      y: 72 + (index % 3) * 84,
      width: 136,
      height: 88,
      fill: palette[index % palette.length],
      label: `Layer ${index + 1}`,
    });
  }

  moveShape(id: string, x: number, y: number) {
    const shape = this.shapes.find((item) => item.id === id);

    if (!shape) {
      return;
    }

    shape.x = Math.round(x);
    shape.y = Math.round(y);
    this.moveCount += 1;
  }

  reset() {
    this.shapes = this.shapes.map((shape, index) => ({
      ...shape,
      x: 88 + (index % 4) * 126,
      y: 96 + (index % 3) * 82,
    }));
    this.moveCount = 0;
    this.selectedId = this.shapes[0]?.id ?? "";
  }
}

export const canvasStore = new CanvasStore();
