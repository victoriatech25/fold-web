import { z } from "zod";

export const addOrderFoldItemSchema = z.strictObject({
  sourceFoldRevisionId: z.uuid(),
  quantity: z.number().int().min(1).max(1_000_000).optional(),
  expectedOrderLockVersion: z.number().int().positive(),
});

export const updateOrderFoldItemSchema = z.strictObject({
  quantity: z.number().int().min(1).max(1_000_000),
  variableValues: z.record(z.string().trim().min(1).max(64), z.string().trim().min(1).max(100)).optional(),
  materialRuleRevisionId: z.uuid().optional(),
  sheetItemId: z.union([z.uuid(), z.null()]).optional(),
  expectedOrderLockVersion: z.number().int().positive(),
  expectedItemLockVersion: z.number().int().positive(),
});

export const orderFoldItemMutationSchema = z.strictObject({
  expectedOrderLockVersion: z.number().int().positive(),
  expectedItemLockVersion: z.number().int().positive().optional(),
});

export const reorderOrderFoldItemsSchema = z.strictObject({
  itemIds: z.array(z.uuid()).max(1_000).refine((items) => new Set(items).size === items.length),
  expectedOrderLockVersion: z.number().int().positive(),
});
