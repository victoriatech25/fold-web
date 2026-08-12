import { z } from "zod";

export const optionalTextSchema = (max: number) =>
  z.union([z.string().trim().max(max), z.null()]).optional();

export const contactFieldsSchema = {
  businessRegistrationNumber: optionalTextSchema(20),
  representativeName: optionalTextSchema(100),
  phone: optionalTextSchema(30),
  email: z.union([z.string().trim().email().max(320), z.literal(""), z.null()]).optional(),
  postalCode: optionalTextSchema(20),
  addressLine1: optionalTextSchema(300),
  addressLine2: optionalTextSchema(300),
};

export const businessSiteTypeSchema = z.enum([
  "HEAD_OFFICE",
  "FACTORY",
  "BRANCH",
  "OTHER",
]);
