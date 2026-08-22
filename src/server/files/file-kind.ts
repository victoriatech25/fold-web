import "server-only";

import type { FileAssetKind } from "@/generated/prisma/client";
import type { PermissionKey } from "@/domain/permission";

export type FileKindPolicy = {
  label: string;
  /** 업로드에 필요한 업무 권한. queue와 같은 규칙으로 종류가 권한을 정한다. */
  uploadPermission: PermissionKey;
  /** 다운로드에 필요한 업무 권한. */
  downloadPermission: PermissionKey;
  /** 허용 media type. 목록에 없는 형식은 받지 않는다(`D2-B02-G`). */
  mediaTypes: readonly string[];
  extensions: readonly string[];
  maxBytes: number;
  /** 사용자가 직접 올릴 수 있는 종류인지. 서버 생성물은 업로드 대상이 아니다. */
  userUploadable: boolean;
  /** 원본에서 다시 만들 수 있어 보존 기간이 지나면 정리하는 종류인지(`D2-B02-J`). */
  regenerable: boolean;
};

const megabyte = 1024 * 1024;

/**
 * 파일 종류마다 권한·형식·크기를 한 곳에서 정한다.
 * 화면이나 라우트가 각자 판단하면 규칙이 갈라진다.
 */
export const fileKindPolicies: Record<FileAssetKind, FileKindPolicy> = {
  DXF: {
    label: "제작 DXF",
    uploadPermission: "output.print",
    downloadPermission: "output.print",
    mediaTypes: ["application/dxf", "image/vnd.dxf"],
    extensions: ["dxf"],
    maxBytes: 20 * megabyte,
    userUploadable: false,
    regenerable: true,
  },
  PDF: {
    label: "출력 PDF",
    uploadPermission: "output.print",
    downloadPermission: "output.print",
    mediaTypes: ["application/pdf"],
    extensions: ["pdf"],
    maxBytes: 50 * megabyte,
    userUploadable: false,
    regenerable: true,
  },
  PREVIEW: {
    label: "미리보기 이미지",
    uploadPermission: "template.fold.edit",
    downloadPermission: "template.fold.read",
    mediaTypes: ["image/png", "image/jpeg", "image/webp"],
    extensions: ["png", "jpg", "jpeg", "webp"],
    maxBytes: 10 * megabyte,
    userUploadable: false,
    regenerable: true,
  },
  FOLD_DOCUMENT: {
    label: "절곡 문서 원본",
    uploadPermission: "template.fold.edit",
    downloadPermission: "template.fold.read",
    mediaTypes: ["application/json"],
    extensions: ["json"],
    maxBytes: 10 * megabyte,
    userUploadable: true,
    regenerable: false,
  },
  IMPORT_SOURCE: {
    label: "가져오기 원본",
    uploadPermission: "admin.manage",
    downloadPermission: "admin.manage",
    mediaTypes: [
      "text/csv",
      "application/json",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/zip",
    ],
    extensions: ["csv", "json", "xls", "xlsx", "zip"],
    maxBytes: 100 * megabyte,
    userUploadable: true,
    regenerable: false,
  },
  OTHER: {
    label: "첨부 파일",
    uploadPermission: "order.edit",
    downloadPermission: "order.read",
    mediaTypes: ["application/pdf", "image/png", "image/jpeg", "text/plain"],
    extensions: ["pdf", "png", "jpg", "jpeg", "txt"],
    maxBytes: 20 * megabyte,
    userUploadable: true,
    regenerable: false,
  },
};

export function fileKindPolicy(kind: FileAssetKind): FileKindPolicy {
  return fileKindPolicies[kind];
}

/** 파일명에서 확장자만 뽑는다. 경로 구분자는 확장자로 보지 않는다. */
export function extensionOf(fileName: string): string | null {
  const base = fileName.split(/[\\/]/).at(-1) ?? "";
  const index = base.lastIndexOf(".");
  if (index <= 0 || index === base.length - 1) return null;
  return base.slice(index + 1).toLowerCase();
}
