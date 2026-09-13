import type { OrganizationStatus, UserStatus } from "@/generated/prisma/client";

/** 회사의 관리자(`ADMINISTRATOR` 역할) 한 사람. 플랫폼 관리자가 누가 그 회사를 맡고 있는지 보는 용도다. */
export type PlatformOrganizationAdministratorDto = {
  userId: string;
  email: string;
  displayName: string;
  status: UserStatus;
};

/** 플랫폼 관리자 화면에서 보는 조직(회사) 한 줄. */
export type PlatformOrganizationDto = {
  id: string;
  code: string;
  name: string;
  status: OrganizationStatus;
  /** 활성 소속 사용자 수. 회사가 실제로 쓰이고 있는지 가늠하는 용도다. */
  memberCount: number;
  administrators: PlatformOrganizationAdministratorDto[];
  /** 로그인한 플랫폼 관리자 자신이 속한 조직인지. 자기 조직은 정지할 수 없다. */
  own: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PlatformOrganizationAdministratorInvitationDto = {
  organization: PlatformOrganizationDto;
  administrator: PlatformOrganizationAdministratorDto;
  /** 비밀번호 설정 일회용 주소. 이 응답에만 실리고 다시 볼 수 없다. */
  invitationUrl: string;
};
