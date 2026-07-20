export const permissionCatalog = [
  { key: "customer.read", description: "거래처 조회" },
  { key: "customer.write", description: "거래처 생성·수정" },
  { key: "material.read", description: "자재와 계산 기준 조회" },
  { key: "material.write", description: "자재와 계산 기준 작성" },
  { key: "material.approve", description: "자재 계산 기준 승인" },
  { key: "template.fold.read", description: "절곡 템플릿 조회" },
  { key: "template.fold.edit", description: "절곡 템플릿 작성" },
  { key: "template.fold.publish", description: "절곡 템플릿 게시" },
  { key: "order.read", description: "작업 문서 조회" },
  { key: "order.edit", description: "작업 문서 작성" },
  { key: "order.calculate", description: "절곡 계산 실행" },
  { key: "order.approve", description: "작업 문서 승인" },
  { key: "cutting.optimize", description: "절단 최적화 실행" },
  { key: "cutting.approve", description: "절단 결과 승인" },
  { key: "output.print", description: "출력·인쇄" },
  { key: "machine.transfer", description: "기계 전송 예정 권한" },
  { key: "admin.manage", description: "조직·사용자·권한 관리" },
] as const;

export type PermissionKey = (typeof permissionCatalog)[number]["key"];

const allPermissionKeys = permissionCatalog.map(({ key }) => key);

export const systemRoleDefinitions = [
  {
    key: "ADMINISTRATOR",
    name: "관리자",
    description: "조직의 사용자·권한을 포함한 전체 업무 관리",
    permissions: allPermissionKeys,
  },
  {
    key: "DESIGNER",
    name: "설계자",
    description: "거래처·절곡 문서 작성, 계산과 출력",
    permissions: [
      "customer.read",
      "customer.write",
      "material.read",
      "template.fold.read",
      "template.fold.edit",
      "order.read",
      "order.edit",
      "order.calculate",
      "cutting.optimize",
      "output.print",
    ],
  },
  {
    key: "APPROVER",
    name: "승인자",
    description: "기준정보·템플릿·작업 문서·절단 결과 승인",
    permissions: [
      "customer.read",
      "customer.write",
      "material.read",
      "material.write",
      "material.approve",
      "template.fold.read",
      "template.fold.edit",
      "template.fold.publish",
      "order.read",
      "order.edit",
      "order.calculate",
      "order.approve",
      "cutting.optimize",
      "cutting.approve",
      "output.print",
    ],
  },
  {
    key: "VIEWER",
    name: "조회자",
    description: "거래처·자재·템플릿·작업 문서 조회",
    permissions: [
      "customer.read",
      "material.read",
      "template.fold.read",
      "order.read",
    ],
  },
] as const satisfies ReadonlyArray<{
  key: string;
  name: string;
  description: string;
  permissions: readonly PermissionKey[];
}>;

export type SystemRoleKey = (typeof systemRoleDefinitions)[number]["key"];

const permissionKeySet = new Set<string>(allPermissionKeys);
const systemRoleKeySet = new Set<string>(
  systemRoleDefinitions.map(({ key }) => key),
);

export function isPermissionKey(value: string): value is PermissionKey {
  return permissionKeySet.has(value);
}

export function isSystemRoleKey(value: string): value is SystemRoleKey {
  return systemRoleKeySet.has(value);
}

export function permissionUnion(
  roles: ReadonlyArray<{ permissions: readonly string[] }>,
): PermissionKey[] {
  return [...new Set(roles.flatMap(({ permissions }) => permissions))]
    .filter(isPermissionKey)
    .sort();
}

export const reservedAdministratorPermission: PermissionKey = "admin.manage";
