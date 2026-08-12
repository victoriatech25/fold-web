import type { BusinessSiteType } from "@/generated/prisma/client";

export type CompanyProfileDto = {
  organizationId: string;
  code: string;
  name: string;
  businessRegistrationNumber: string | null;
  representativeName: string | null;
  phone: string | null;
  email: string | null;
  postalCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  organizationLockVersion: number;
  profileLockVersion: number;
  updatedAt: string;
};

export type BusinessSiteDto = {
  id: string;
  code: string;
  name: string;
  type: BusinessSiteType;
  businessRegistrationNumber: string | null;
  representativeName: string | null;
  phone: string | null;
  email: string | null;
  postalCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  isDefault: boolean;
  active: boolean;
  lockVersion: number;
  updatedAt: string;
};

export type CompanySettingsDto = {
  company: CompanyProfileDto;
  businessSites: BusinessSiteDto[];
};

export type CompanyProfileFields = {
  name: string;
  businessRegistrationNumber?: string | null;
  representativeName?: string | null;
  phone?: string | null;
  email?: string | null;
  postalCode?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
};

export type BusinessSiteFields = {
  name: string;
  type: BusinessSiteType;
  businessRegistrationNumber?: string | null;
  representativeName?: string | null;
  phone?: string | null;
  email?: string | null;
  postalCode?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
};
