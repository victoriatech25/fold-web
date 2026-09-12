import { describe, expect, it } from "vitest";

import { crc32, createZip } from "@/server/dxf/zip-writer";

const encoder = new TextEncoder();

describe("zip writer", () => {
  it("CRC-32 표준 벡터와 일치한다", () => {
    expect(crc32(encoder.encode("123456789")).toString(16)).toBe("cbf43926");
  });

  it("local header·central directory·end record 를 순서대로 놓는다", () => {
    const zip = createZip([
      { name: "260912-01-A.dxf", data: encoder.encode("0\r\nSECTION\r\n") },
      { name: "한글.dxf", data: encoder.encode("hello") },
    ]);
    const u32 = (offset: number) => zip[offset] | (zip[offset + 1] << 8) | (zip[offset + 2] << 16) | (zip[offset + 3] << 24);
    expect(u32(0) >>> 0).toBe(0x04034b50);
    const endOffset = zip.length - 22;
    expect(u32(endOffset) >>> 0).toBe(0x06054b50);
    expect(zip[endOffset + 10]).toBe(2); // entry count
    const centralOffset = u32(endOffset + 16);
    expect(u32(centralOffset) >>> 0).toBe(0x02014b50);
    // 한글 이름은 UTF-8 그대로 두 번(local·central) 들어가고 플래그 bit 11 이 켜진다.
    const text = new TextDecoder("utf-8").decode(zip);
    expect(text.split("한글.dxf")).toHaveLength(3);
    expect(zip[6] | (zip[7] << 8)).toBe(0x0800);
  });
});
