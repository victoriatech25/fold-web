import type { CustomerType } from "@/generated/prisma/client";

export type CustomerSummaryDto = {
  id: string;
  code: string;
  type: CustomerType;
  name: string;
  businessRegistrationNumber: string | null;
  representativeName: string | null;
  phone: string | null;
  active: boolean;
  lockVersion: number;
  contactCount: number;
  siteCount: number;
  primaryContactName: string | null;
  defaultSiteName: string | null;
  updatedAt: string;
};

export type CustomerContactDto = {
  id: string;
  customerSiteId: string | null;
  name: string;
  department: string | null;
  title: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  isPrimary: boolean;
  active: boolean;
  lockVersion: number;
  updatedAt: string;
};

export type CustomerSiteDto = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  postalCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  memo: string | null;
  isDefault: boolean;
  active: boolean;
  lockVersion: number;
  updatedAt: string;
};

export type CustomerDetailDto = CustomerSummaryDto & {
  fax: string | null;
  email: string | null;
  website: string | null;
  postalCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  taxInvoiceEnabled: boolean;
  memo: string | null;
  businessRegistrationDuplicate: boolean;
  contacts: CustomerContactDto[];
  sites: CustomerSiteDto[];
};

export type CustomerListDto = {
  items: CustomerSummaryDto[];
  nextCursor: string | null;
};

export type CustomerFields = {
  type: CustomerType;
  name: string;
  businessRegistrationNumber?: string | null;
  representativeName?: string | null;
  phone?: string | null;
  fax?: string | null;
  email?: string | null;
  website?: string | null;
  postalCode?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  taxInvoiceEnabled: boolean;
  memo?: string | null;
};

export type CustomerContactFields = {
  customerSiteId?: string | null;
  name: string;
  department?: string | null;
  title?: string | null;
  phone?: string | null;
  mobile?: string | null;
  email?: string | null;
};

export type CustomerSiteFields = {
  code: string;
  name: string;
  phone?: string | null;
  postalCode?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  memo?: string | null;
};
