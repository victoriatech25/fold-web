import { z } from "zod";

const optionalText = (max: number) =>
  z.union([z.string().trim().max(max), z.literal(""), z.null()]).optional();

export const customerTypeSchema = z.enum([
  "SALES",
  "PURCHASE",
  "TEMPORARY",
  "INTERNAL",
  "OTHER",
]);

export const customerFieldsSchema = {
  type: customerTypeSchema,
  name: z.string().trim().min(1).max(200),
  businessRegistrationNumber: optionalText(20),
  representativeName: optionalText(100),
  phone: optionalText(30),
  fax: optionalText(30),
  email: z.union([z.string().trim().email().max(320), z.literal(""), z.null()]).optional(),
  website: optionalText(500),
  postalCode: optionalText(20),
  addressLine1: optionalText(300),
  addressLine2: optionalText(300),
  taxInvoiceEnabled: z.boolean(),
  memo: optionalText(2_000),
};

export const customerContactFieldsSchema = {
  customerSiteId: z.union([z.uuid(), z.null()]).optional(),
  name: z.string().trim().min(1).max(100),
  department: optionalText(100),
  title: optionalText(100),
  phone: optionalText(30),
  mobile: optionalText(30),
  email: z.union([z.string().trim().email().max(320), z.literal(""), z.null()]).optional(),
};

export const customerSiteFieldsSchema = {
  code: z.string().trim().min(2).max(50),
  name: z.string().trim().min(1).max(200),
  phone: optionalText(30),
  postalCode: optionalText(20),
  addressLine1: optionalText(300),
  addressLine2: optionalText(300),
  memo: optionalText(2_000),
};
