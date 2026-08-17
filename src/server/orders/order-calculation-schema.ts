import { z } from "zod";

export const createOrderCalculationSchema = z.strictObject({
  expectedOrderLockVersion: z.number().int().positive(),
});
