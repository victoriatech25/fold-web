import type { CuttingSheet } from "@/domain/cutting/schema";

/**
 * 재단 좌표(왼쪽 아래 원점, x 폭, y 길이)와 화면 좌표 사이의 변환(`D2-B05-L`).
 * 긴 쪽이 가로로, 배치 원점이 좌상단에 오게 그린다. 좌표를 새로 계산하지 않고
 * 보는 방향만 바꾼다. 세로가 긴 원판은 x·y 를 맞바꿔 눕힌다.
 */
export type ScreenRect = { x: number; y: number; width: number; height: number };

export function isLandscape(sheet: Pick<CuttingSheet, "widthMm" | "lengthMm">): boolean {
  return Number(sheet.lengthMm) > Number(sheet.widthMm);
}

export function screenViewBox(sheet: Pick<CuttingSheet, "widthMm" | "lengthMm">): { width: number; height: number } {
  const width = Number(sheet.widthMm);
  const length = Number(sheet.lengthMm);
  return isLandscape(sheet) ? { width: length, height: width } : { width, height: length };
}

export function toScreenRect(rect: ScreenRect, landscape: boolean): ScreenRect {
  return landscape ? { x: rect.y, y: rect.x, width: rect.height, height: rect.width } : rect;
}

export function fromScreenRect(rect: ScreenRect, landscape: boolean): ScreenRect {
  return toScreenRect(rect, landscape);
}

export function fromScreenPoint(point: { x: number; y: number }, landscape: boolean): { x: number; y: number } {
  return landscape ? { x: point.y, y: point.x } : point;
}
