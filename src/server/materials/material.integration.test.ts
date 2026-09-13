import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { PermissionDeniedError } from "@/server/authorization/authorization";
import { disconnectPrisma, getPrisma } from "@/server/db/prisma";
import { resolvePublishedMaterialRuleSnapshot } from "@/server/fold-document/material-snapshot";
import { MaterialError } from "./material-error";
import { createMaterial, createMaterialVariant, deleteMaterials, getMaterial, listMaterials, updateMaterial, updateMaterialVariant } from "./material-service";

const integration=process.env.RUN_DB_INTEGRATION==="1"?describe:describe.skip;
let prisma:PrismaClient;let context:AuthenticatedContext;let otherOrganizationId:string;
const base={code:"SUS",name:"스테인리스",densityKgPerM3:"7930",sortOrder:10,memo:null};
integration.sequential("material and thickness integration",()=>{
  beforeAll(async()=>{prisma=getPrisma();const organization=await prisma.organization.create({data:{code:"MATERIALS",name:"재질 통합 조직"}});otherOrganizationId=(await prisma.organization.create({data:{code:"MATERIALS_OTHER",name:"다른 조직"}})).id;const user=await prisma.user.create({data:{email:"material-integration@example.test",normalizedEmail:"material-integration@example.test",displayName:"재질 관리자",status:"ACTIVE"}});context={sessionId:crypto.randomUUID(),userId:user.id,displayName:user.displayName,membershipId:crypto.randomUUID(),departmentId:null,organizationId:organization.id,organizationCode:organization.code,organizationName:organization.name,platformAdmin: false, roleKeys:["MATERIAL_MANAGER"],permissions:["material.read","material.write"],expiresAt:new Date("2027-01-01T00:00:00Z")};});
  afterAll(async()=>disconnectPrisma());
  it("creates searchable materials and rejects normalized duplicates",async()=>{const material=await createMaterial(prisma,context,{...base,code:" sus ",requestId:"m-create"});expect(material).toMatchObject({code:"SUS",densityKgPerM3:"7930",active:true});expect((await listMaterials(prisma,context,{q:"스테인",limit:25})).items.map(x=>x.id)).toContain(material.id);await expect(createMaterial(prisma,context,{...base,code:"SUS2",name:"  스테인리스 ",requestId:"m-duplicate"})).rejects.toBeInstanceOf(MaterialError);});
  it("creates variants without inventing rules and keeps immutable identity",async()=>{const material=await createMaterial(prisma,context,{...base,code:"ALLOY",name:"합금",requestId:"v-parent"});const variant=await createMaterialVariant(prisma,context,{materialId:material.id,code:"ALLOY-12",name:"합금 1.2T",thicknessMm:"1.200",defaultInsideRadiusMm:"1.2",sortOrder:1,requestId:"v-create"});expect(variant).toMatchObject({thicknessMm:"1.2",publishedRule:null});expect((await getMaterial(prisma,context,material.id)).calculationRequiredCount).toBe(1);await expect(updateMaterialVariant(prisma,context,{materialId:material.id,variantId:variant.id,code:variant.code,name:variant.name,thicknessMm:"1.3",defaultInsideRadiusMm:"1.2",sortOrder:1,active:true,expectedLockVersion:variant.lockVersion,requestId:"v-immutable"})).rejects.toMatchObject({code:"CONFLICT"});});
  it("freezes radius in a published rule snapshot",async()=>{const material=await createMaterial(prisma,context,{...base,code:"SNAP",name:"스냅샷",requestId:"snap-parent"});const variant=await createMaterialVariant(prisma,context,{materialId:material.id,code:"SNAP-2",name:"스냅 2T",thicknessMm:"2",defaultInsideRadiusMm:"2",sortOrder:0,requestId:"snap-variant"});const rule=await prisma.materialRuleRevision.create({data:{organizationId:context.organizationId,materialVariantId:variant.id,revisionNumber:1,status:"PUBLISHED",calculationMode:"FIXED",vCutEnabled:true,decimalPlaces:1,decimalOperation:"ROUND",cutAngleDeg:"135",insideBendRadiusMm:"2",elongationVCutMm:"1.2",elongationACutMm:"0.8",elongationNoCutMm:"2",cutDepthVCutMm:"0.5",cutDepthACutMm:"0.5",cutDepthNoCutMm:"0",publishedAt:new Date()}});const updated=await updateMaterialVariant(prisma,context,{materialId:material.id,variantId:variant.id,code:variant.code,name:variant.name,thicknessMm:variant.thicknessMm,defaultInsideRadiusMm:"3",sortOrder:0,active:true,expectedLockVersion:variant.lockVersion,requestId:"snap-update"});expect(updated.defaultInsideRadiusMm).toBe("3");expect((await resolvePublishedMaterialRuleSnapshot(prisma,context.organizationId,rule.id)).insideBendRadiusMm).toBe("2");expect((await getMaterial(prisma,context,material.id)).calculationRequiredCount).toBe(0);});
  it("enforces lock, permission, organization and parent inactive behavior",async()=>{const material=await createMaterial(prisma,context,{...base,code:"BOUND",name:"경계",requestId:"bound-create"});const changed=await updateMaterial(prisma,context,{...base,materialId:material.id,code:material.code,name:"경계 변경",active:false,expectedLockVersion:material.lockVersion,requestId:"bound-update"});expect(changed.active).toBe(false);await expect(updateMaterial(prisma,context,{...base,materialId:material.id,code:material.code,active:true,expectedLockVersion:material.lockVersion,requestId:"bound-stale"})).rejects.toMatchObject({code:"CONFLICT"});await expect(getMaterial(prisma,{...context,organizationId:otherOrganizationId},material.id)).rejects.toMatchObject({code:"NOT_FOUND"});await expect(listMaterials(prisma,{...context,permissions:[]},{limit:25})).rejects.toBeInstanceOf(PermissionDeniedError);expect((await listMaterials(prisma,context,{limit:25})).items.map(x=>x.id)).not.toContain(material.id);expect((await listMaterials(prisma,context,{includeInactive:true,limit:25})).items.map(x=>x.id)).toContain(material.id);});
  it("선택 삭제는 재질과 두께를 숨기고 상세·목록·설계 선택에서 빼며, 다른 조직 재질은 건드리지 못한다",async()=>{
    const material=await createMaterial(prisma,context,{...base,code:"DEL",name:"삭제 재질",requestId:"d-create"});
    const variant=await createMaterialVariant(prisma,context,{materialId:material.id,code:"DEL-1",name:"삭제 1T",thicknessMm:"1",defaultInsideRadiusMm:"1",sortOrder:0,requestId:"d-variant"});
    await expect(deleteMaterials(prisma,{...context,permissions:["material.read"]},{materialIds:[material.id],requestId:"d-denied"})).rejects.toBeInstanceOf(PermissionDeniedError);
    const other=await prisma.material.create({data:{organizationId:otherOrganizationId,code:"OTHER-DEL",name:"남의 재질",normalizedName:"남의 재질"}});
    await expect(deleteMaterials(prisma,context,{materialIds:[material.id,other.id],requestId:"d-cross"})).rejects.toMatchObject({code:"NOT_FOUND"});
    // 트랜잭션이라 앞 항목도 되돌아간다.
    expect((await prisma.material.findUniqueOrThrow({where:{id:material.id}})).deletedAt).toBeNull();
    expect(await deleteMaterials(prisma,context,{materialIds:[material.id,material.id],requestId:"d-delete"})).toEqual({deletedCount:1});
    expect((await prisma.material.findUniqueOrThrow({where:{id:material.id}})).deletedAt).not.toBeNull();
    expect((await prisma.materialVariant.findUniqueOrThrow({where:{id:variant.id}})).deletedAt).not.toBeNull();
    await expect(getMaterial(prisma,context,material.id)).rejects.toMatchObject({code:"NOT_FOUND"});
    expect((await listMaterials(prisma,context,{includeInactive:true,limit:100})).items.map(x=>x.id)).not.toContain(material.id);
    expect((await prisma.auditEvent.findFirst({where:{action:"material.deleted",entityId:material.id}}))?.organizationId).toBe(context.organizationId);
    await expect(deleteMaterials(prisma,context,{materialIds:[material.id],requestId:"d-again"})).rejects.toMatchObject({code:"NOT_FOUND"});
    expect((await prisma.material.findUniqueOrThrow({where:{id:other.id}})).deletedAt).toBeNull();
    // 삭제한 재질의 코드·이름과 두께 코드는 다시 쓸 수 있다. 고유는 살아 있는 행에만 걸린다.
    const again=await createMaterial(prisma,context,{...base,code:"DEL",name:"삭제 재질",requestId:"d-recreate"});
    expect(again.id).not.toBe(material.id);
    const againVariant=await createMaterialVariant(prisma,context,{materialId:again.id,code:"DEL-1",name:"삭제 1T",thicknessMm:"1",defaultInsideRadiusMm:"1",sortOrder:0,requestId:"d-recreate-variant"});
    expect(againVariant.code).toBe("DEL-1");
    // 살아 있는 행끼리는 여전히 막힌다.
    await expect(createMaterial(prisma,context,{...base,code:"DEL",name:"삭제 재질 2",requestId:"d-dup"})).rejects.toMatchObject({code:"CONFLICT"});
  });
});
