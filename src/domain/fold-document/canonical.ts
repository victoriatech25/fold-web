export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

function compareUnicodeCodePoints(left: string, right: string) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

export function projectCanonicalJsonV1(value: unknown): string {
  const active = new WeakSet<object>();

  const serialize = (current: unknown): string => {
    if (current === null) return "null";
    if (typeof current === "string" || typeof current === "boolean") {
      return JSON.stringify(current);
    }
    if (typeof current === "number") {
      if (!Number.isSafeInteger(current)) {
        throw new CanonicalJsonError("canonical JSON의 number는 안전한 정수만 허용합니다.");
      }
      return JSON.stringify(current);
    }
    if (typeof current !== "object") {
      throw new CanonicalJsonError("canonical JSON에서 지원하지 않는 값입니다.");
    }
    if (active.has(current)) {
      throw new CanonicalJsonError("순환 참조는 canonical JSON으로 만들 수 없습니다.");
    }
    active.add(current);

    try {
      if (Array.isArray(current)) {
        const items: string[] = [];
        for (let index = 0; index < current.length; index += 1) {
          if (!(index in current)) {
            throw new CanonicalJsonError("sparse array는 canonical JSON에서 허용하지 않습니다.");
          }
          items.push(serialize(current[index]));
        }
        return `[${items.join(",")}]`;
      }

      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new CanonicalJsonError("plain object만 canonical JSON으로 만들 수 있습니다.");
      }
      const record = current as Record<string, unknown>;
      const entries = Object.keys(record)
        .sort(compareUnicodeCodePoints)
        .map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`);
      return `{${entries.join(",")}}`;
    } finally {
      active.delete(current);
    }
  };

  return serialize(value);
}
