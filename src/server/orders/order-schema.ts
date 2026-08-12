import { z } from "zod";

const optionalText = (max: number) => z.union([z.string().trim().max(max), z.literal(""), z.null()]).optional();
const optionalUuid = z.union([z.uuid(), z.null()]).optional();
export const orderFieldsSchema = {
  customerId: z.uuid(), customerSiteId: optionalUuid, customerContactId: optionalUuid,
  ownerMembershipId: optionalUuid, dueDate: z.union([z.iso.date(), z.literal(""), z.null()]).optional(),
  externalReference: optionalText(200), memo: optionalText(4_000),
};
export const orderCancelSchema = z.strictObject({ expectedLockVersion: z.number().int().positive(), cancellationReason: z.string().trim().min(1).max(500) });
