export type AuthenticatedContext = {
  sessionId: string;
  userId: string;
  displayName: string;
  organizationId: string;
  organizationCode: string;
  organizationName: string;
  expiresAt: Date;
};

export type SessionUserDto = {
  userId: string;
  displayName: string;
  organization: {
    id: string;
    code: string;
    name: string;
  };
  expiresAt: string;
};

export function toSessionUserDto(
  context: AuthenticatedContext,
): SessionUserDto {
  return {
    userId: context.userId,
    displayName: context.displayName,
    organization: {
      id: context.organizationId,
      code: context.organizationCode,
      name: context.organizationName,
    },
    expiresAt: context.expiresAt.toISOString(),
  };
}
