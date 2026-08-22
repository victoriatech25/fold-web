export const permissionCatalog = [
  { key: "master_data.read", group: "기준정보", label: "회사·사업장 조회", description: "회사·사업장 기준정보 조회" },
  { key: "master_data.manage", group: "기준정보", label: "회사·사업장 관리", description: "회사·사업장 기준정보 관리" },
  { key: "customer.read", group: "거래처", label: "거래처 조회", description: "거래처 조회" },
  { key: "customer.write", group: "거래처", label: "거래처 작성", description: "거래처 생성·수정" },
  { key: "material.read", group: "재질·자재", label: "재질 조회", description: "자재와 계산 기준 조회" },
  { key: "material.write", group: "재질·자재", label: "재질 작성", description: "자재와 계산 기준 작성" },
  { key: "material.approve", group: "재질·자재", label: "계산 기준 승인", description: "자재 계산 기준 승인" },
  { key: "pricing.read", group: "가격", label: "가격 조회", description: "가격등급·가격표와 계산 결과 조회" },
  { key: "pricing.write", group: "가격", label: "가격 작성", description: "가격등급·가격표 작성" },
  { key: "pricing.approve", group: "가격", label: "가격표 게시", description: "가격표 검토·게시" },
  { key: "template.fold.read", group: "템플릿", label: "템플릿 조회", description: "절곡 템플릿 조회" },
  { key: "template.fold.edit", group: "템플릿", label: "템플릿 작성", description: "절곡 템플릿 작성" },
  { key: "template.fold.publish", group: "템플릿", label: "템플릿 게시", description: "절곡 템플릿 게시" },
  { key: "order.read", group: "수주", label: "수주 조회", description: "작업 문서 조회" },
  { key: "order.edit", group: "수주", label: "수주 작성", description: "작업 문서 작성" },
  { key: "order.calculate", group: "수주", label: "절곡 계산", description: "절곡 계산 실행" },
  { key: "order.approve", group: "수주", label: "수주 승인", description: "작업 문서 승인" },
  { key: "cutting.optimize", group: "생산", label: "절단 최적화", description: "절단 최적화 실행" },
  { key: "cutting.approve", group: "생산", label: "절단 결과 승인", description: "절단 결과 승인" },
  { key: "output.print", group: "출력", label: "출력·인쇄", description: "출력·인쇄" },
  { key: "machine.transfer", group: "출력", label: "기계 전송", description: "기계 전송 예정 권한" },
  { key: "admin.manage", group: "관리", label: "조직·권한 관리", description: "조직·사용자·권한 관리" },
  { key: "audit.read", group: "관리", label: "감사 로그 조회", description: "감사 로그 조회" },
] as const;

/** 화면에 권한을 묶어 보여줄 때 쓰는 분류 순서. */
export const permissionGroupOrder = [
  "기준정보",
  "거래처",
  "재질·자재",
  "가격",
  "템플릿",
  "수주",
  "생산",
  "출력",
  "관리",
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
      "master_data.read",
      "customer.read",
      "customer.write",
      "material.read",
      "pricing.read",
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
      "master_data.read",
      "master_data.manage",
      "customer.read",
      "customer.write",
      "material.read",
      "material.write",
      "material.approve",
      "pricing.read",
      "pricing.write",
      "pricing.approve",
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
      "master_data.read",
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

export const reservedAdministratorPermissions = [
  "admin.manage",
  "audit.read",
] as const satisfies readonly PermissionKey[];

export function isReservedAdministratorPermission(
  permission: PermissionKey,
): boolean {
  return (reservedAdministratorPermissions as readonly PermissionKey[]).includes(
    permission,
  );
}
