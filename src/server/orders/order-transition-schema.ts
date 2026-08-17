import { z } from "zod";

export const orderTransitionActions = [
  "APPROVE",
  "CANCEL_APPROVAL",
  "REQUEST_PRODUCTION",
  "START_PRODUCTION",
  "COMPLETE_PRODUCTION",
  "CLOSE",
] as const;

export const orderTransitionSchema = z.strictObject({
  action: z.enum(orderTransitionActions),
  expectedLockVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export type OrderTransitionAction = (typeof orderTransitionActions)[number];
