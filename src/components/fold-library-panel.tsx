"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useCommonPopup } from "@/components/ui/common-popup";
import {
  copyFoldTemplate,
  createFoldCategory,
  createNextFoldRevision,
  getFoldRevision,
  getFoldTemplate,
  listFoldCategories,
  listFoldTemplates,
  transitionFoldRevision,
  updateFoldCategory,
  updateFoldTemplate,
  type FoldTemplateFilters,
} from "@/client/fold-library/fold-library-api";
import type { ServerFoldDocument } from "@/domain/fold-document/schema";
import type {
  FoldCategoryDto,
  FoldRevisionDetailDto,
  FoldRevisionSummaryDto,
  FoldTemplateDetailDto,
  FoldTemplateSummaryDto,
} from "@/server/fold-library/fold-library-types";

type Props = { canEdit: boolean; canPublish: boolean };
type Status = FoldRevisionSummaryDto["status"];

const statusLabel: Record<Status, string> = {
  DRAFT: "초안",
  REVIEW: "검토 중",
  PUBLISHED: "게시",
  RETIRED: "폐기",
};

const statusClass: Record<Status, string> = {
  DRAFT: "bg-blue-100 text-blue-800",
  REVIEW: "bg-amber-100 text-amber-800",
  PUBLISHED: "bg-emerald-100 text-emerald-800",
  RETIRED: "bg-slate-200 text-slate-700",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function DocumentPreview({ document }: { document: ServerFoldDocument }) {
  const segments = document.blocks.flatMap((block) => block.segments);
  const points = segments.flatMap((segment) => [segment.geometry.start, segment.geometry.end]).map((point) => ({
    x: Number(point.xMm),
    y: Number(point.yMm),
  }));
  if (points.length === 0) {
    return (
      <div
        aria-label="선택 개정 형상 미리보기"
        className="flex h-48 items-center justify-center rounded border border-slate-200 bg-white text-xs text-slate-500"
        role="img"
      >
        표시할 선분이 없습니다.
      </div>
    );
  }
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const padding = Math.max(width, height) * 0.12;
  return (
    <svg
      aria-label="선택 개정 형상 미리보기"
      className="h-48 w-full rounded border border-slate-200 bg-white"
      role="img"
      viewBox={`${minX - padding} ${minY - padding} ${width + padding * 2} ${height + padding * 2}`}
    >
      {segments.map((segment) => (
        <line
          key={segment.id}
          stroke="#0f766e"
          strokeLinecap="round"
          strokeWidth={Math.max(width, height) / 120}
          x1={segment.geometry.start.xMm}
          x2={segment.geometry.end.xMm}
          y1={segment.geometry.start.yMm}
          y2={segment.geometry.end.yMm}
        />
      ))}
    </svg>
  );
}

function flatten(value: unknown, path = "문서"): Map<string, string> {
  const result = new Map<string, string>();
  if (value === null || typeof value !== "object") {
    result.set(path, JSON.stringify(value));
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      for (const [key, entry] of flatten(item, `${path}[${index}]`)) result.set(key, entry);
    });
    if (value.length === 0) result.set(path, "[]");
    return result;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  entries.forEach(([key, item]) => {
    for (const [childPath, entry] of flatten(item, `${path}.${key}`)) result.set(childPath, entry);
  });
  if (entries.length === 0) result.set(path, "{}");
  return result;
}

function documentDifferences(left: ServerFoldDocument, right: ServerFoldDocument) {
  const a = flatten(left);
  const b = flatten(right);
  return [...new Set([...a.keys(), ...b.keys()])]
    .filter((path) => a.get(path) !== b.get(path))
    .sort()
    .map((path) => ({ path, left: a.get(path) ?? "(없음)", right: b.get(path) ?? "(없음)" }));
}

export function FoldLibraryPanel({ canEdit, canPublish }: Props) {
  const { confirm: confirmPopup, prompt: promptPopup } = useCommonPopup();
  const [categories, setCategories] = useState<FoldCategoryDto[]>([]);
  const [templates, setTemplates] = useState<FoldTemplateSummaryDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<FoldTemplateDetailDto | null>(null);
  const [revisionDetail, setRevisionDetail] = useState<FoldRevisionDetailDto | null>(null);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<FoldTemplateFilters>({});
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metaName, setMetaName] = useState("");
  const [metaCategoryId, setMetaCategoryId] = useState("");
  const [compareIds, setCompareIds] = useState<[string, string]>(["", ""]);
  const [compareDetails, setCompareDetails] = useState<[FoldRevisionDetailDto, FoldRevisionDetailDto] | null>(null);

  const refreshCategories = useCallback(async () => {
    setCategories(await listFoldCategories(canEdit));
  }, [canEdit]);

  const loadTemplates = useCallback(async (filters: FoldTemplateFilters, append = false) => {
    setBusy(true);
    setError(null);
    try {
      const result = await listFoldTemplates(filters);
      setTemplates((current) => append ? [...current, ...result.items] : result.items);
      setNextCursor(result.nextCursor);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([refreshCategories(), loadTemplates({})]).catch((loadError) => setError(errorMessage(loadError)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadTemplates, refreshCategories]);

  async function openTemplate(templateId: string) {
    setBusy(true);
    setError(null);
    try {
      const detail = await getFoldTemplate(templateId);
      setSelected(detail);
      setMetaName(detail.name);
      setMetaCategoryId(detail.category?.id ?? "");
      setCompareDetails(null);
      setCompareIds([detail.revisions[1]?.revisionId ?? "", detail.revisions[0]?.revisionId ?? ""]);
      const current = detail.currentRevision;
      setRevisionDetail(current ? await getFoldRevision(current.revisionId) : null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setBusy(false);
    }
  }

  async function refreshSelected(detail: FoldTemplateDetailDto, success: string) {
    if (detail.revisions.length === 0) {
      setSelected(null);
      setRevisionDetail(null);
      setMessage(success);
      await loadTemplates(appliedFilters);
      return;
    }
    setSelected(detail);
    setMetaName(detail.name);
    setMetaCategoryId(detail.category?.id ?? "");
    setRevisionDetail(detail.currentRevision ? await getFoldRevision(detail.currentRevision.revisionId) : null);
    setMessage(success);
    await loadTemplates(appliedFilters);
  }

  async function runMutation(work: () => Promise<FoldTemplateDetailDto>, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await refreshSelected(await work(), success);
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    } finally {
      setBusy(false);
    }
  }

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    const filters: FoldTemplateFilters = {
      q: query.trim() || undefined,
      categoryId: categoryId || undefined,
      status: status || undefined,
      documentType: documentType || undefined,
    };
    setAppliedFilters(filters);
    setSelected(null);
    setRevisionDetail(null);
    void loadTemplates(filters);
  }

  function applyCategoryFilter(nextCategoryId: string) {
    setCategoryId(nextCategoryId);
    const filters: FoldTemplateFilters = {
      ...appliedFilters,
      categoryId: nextCategoryId || undefined,
    };
    setAppliedFilters(filters);
    setSelected(null);
    setRevisionDetail(null);
    void loadTemplates(filters);
  }

  async function addCategory() {
    const name = await promptPopup({
      title: "분류 추가",
      message: "템플릿을 구분할 새 분류를 만듭니다.",
      inputLabel: "분류 이름",
      confirmText: "추가",
      maxLength: 120,
      required: true,
    });
    if (!name?.trim()) return;
    setBusy(true);
    try {
      await createFoldCategory({ name: name.trim(), sortOrder: categories.length * 10 + 10 });
      await refreshCategories();
      setMessage("분류를 생성했습니다.");
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    } finally {
      setBusy(false);
    }
  }

  async function editCategory(category: FoldCategoryDto) {
    const name = await promptPopup({
      title: "분류 수정",
      message: "분류 이름을 변경합니다.",
      inputLabel: "분류 이름",
      defaultValue: category.name,
      confirmText: "이름 적용",
      maxLength: 120,
      required: true,
    });
    if (!name?.trim()) return;
    const changeStatus = await confirmPopup({
      title: category.active ? "분류 비활성화" : "분류 활성화",
      message: category.active
        ? "이름을 저장하면서 이 분류를 선택 목록에서 숨기시겠습니까? 기존 템플릿의 분류 정보는 유지됩니다."
        : "이름을 저장하면서 이 분류를 다시 선택할 수 있도록 활성화하시겠습니까?",
      confirmText: category.active ? "비활성화" : "활성화",
      cancelText: "현재 상태 유지",
      variant: category.active ? "warning" : "info",
    });
    const active = changeStatus ? !category.active : category.active;
    setBusy(true);
    try {
      await updateFoldCategory({ ...category, name: name.trim(), active });
      await refreshCategories();
      setMessage("분류를 변경했습니다.");
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    } finally {
      setBusy(false);
    }
  }

  async function changeRevision(revision: FoldRevisionSummaryDto) {
    setBusy(true);
    try {
      setRevisionDetail(await getFoldRevision(revision.revisionId));
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setBusy(false);
    }
  }

  async function compareRevisions() {
    if (!compareIds[0] || !compareIds[1] || compareIds[0] === compareIds[1]) {
      setError("서로 다른 개정 두 개를 선택해 주세요.");
      return;
    }
    setBusy(true);
    try {
      setCompareDetails(await Promise.all([getFoldRevision(compareIds[0]), getFoldRevision(compareIds[1])]));
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setBusy(false);
    }
  }

  async function requestReview(revision: FoldRevisionSummaryDto) {
    const confirmed = await confirmPopup({
      title: "검토 요청",
      message: "자동 저장이 완료된 현재 초안을 검토 상태로 전환하시겠습니까? 검토 중에는 문서를 편집할 수 없습니다.",
      confirmText: "검토 요청",
      variant: "warning",
    });
    if (confirmed) await runMutation(() => transitionFoldRevision({ revisionId: revision.revisionId, expectedLockVersion: revision.lockVersion, action: "review" }), "검토를 요청했습니다.");
  }

  async function publishRevision(revision: FoldRevisionSummaryDto) {
    const confirmed = await confirmPopup({
      title: "개정 게시",
      message: "이 개정을 신규 사용 가능한 게시본으로 확정하시겠습니까? 기존 게시본이 있으면 자동으로 폐기 상태가 됩니다.",
      confirmText: "게시",
      variant: "warning",
    });
    if (confirmed) await runMutation(() => transitionFoldRevision({ revisionId: revision.revisionId, expectedLockVersion: revision.lockVersion, action: "publish" }), "개정을 게시했습니다.");
  }

  async function retireRevision(revision: FoldRevisionSummaryDto) {
    const confirmed = await confirmPopup({
      title: "게시본 폐기",
      message: "이 게시본을 신규 사용 대상에서 제외하시겠습니까? 개정 이력과 문서는 보존됩니다.",
      confirmText: "폐기",
      variant: "danger",
    });
    if (confirmed) await runMutation(() => transitionFoldRevision({ revisionId: revision.revisionId, expectedLockVersion: revision.lockVersion, action: "retire" }), "게시본을 폐기했습니다.");
  }

  async function copyTemplate(revision: FoldRevisionSummaryDto, asPanel = false) {
    if (!selected) return;
    const name = await promptPopup({
      title: asPanel ? "패널 템플릿 만들기" : "다른 이름으로 복사",
      message: asPanel ? "선택한 일반 단면을 재사용 가능한 패널 템플릿 초안으로 복사합니다." : "선택한 개정을 독립된 새 템플릿의 초안으로 복사합니다.",
      inputLabel: "새 템플릿 이름",
      defaultValue: `${selected.name}${asPanel ? " 패널" : " 복사본"}`,
      confirmText: "복사",
      maxLength: 120,
      required: true,
    });
    if (!name?.trim()) return;
    await runMutation(() => copyFoldTemplate({
      sourceRevisionId: revisionDetail?.revisionId ?? revision.revisionId,
      draftId: crypto.randomUUID(),
      name: name.trim(),
      categoryId: selected.category?.id ?? null,
      ...(asPanel ? { targetDocumentType: "panel" as const } : {}),
    }), asPanel ? "패널 템플릿 초안을 만들었습니다." : "새 템플릿으로 복사했습니다.");
  }

  async function discardDraft(revision: FoldRevisionSummaryDto) {
    const confirmed = await confirmPopup({
      title: "초안 취소",
      message: "현재 작업 개정을 취소하시겠습니까? 게시 이력이 없는 템플릿은 목록에서도 제거됩니다.",
      confirmText: "초안 취소",
      variant: "danger",
    });
    if (confirmed) await runMutation(() => transitionFoldRevision({ revisionId: revision.revisionId, expectedLockVersion: revision.lockVersion, action: "discard" }), "초안을 취소했습니다.");
  }

  const differences = useMemo(
    () => compareDetails ? documentDifferences(compareDetails[0].document, compareDetails[1].document) : [],
    [compareDetails],
  );

  const current = selected?.currentRevision ?? null;
  const activeCategories = categories.filter((category) => category.active);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm">
        <form className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_220px_160px_160px_auto]" onSubmit={submitSearch}>
          <label className="text-xs font-bold text-slate-700">이름 또는 코드
            <input aria-label="템플릿 이름 또는 코드" className="field-control" onChange={(event) => setQuery(event.target.value)} placeholder="검색어" value={query} />
          </label>
          <label className="text-xs font-bold text-slate-700">분류
            <select aria-label="템플릿 분류 필터" className="field-control" onChange={(event) => setCategoryId(event.target.value)} value={categoryId}>
              <option value="">전체 분류</option><option value="uncategorized">미분류</option>
              {activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">상태
            <select aria-label="템플릿 상태 필터" className="field-control" onChange={(event) => setStatus(event.target.value)} value={status}>
              <option value="">전체 상태</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">도면 타입
            <select aria-label="템플릿 타입 필터" className="field-control" onChange={(event) => setDocumentType(event.target.value)} value={documentType}>
              <option value="">전체 타입</option><option value="NORMAL">일반</option><option value="BOX">박스</option><option value="PANEL">패널</option>
            </select>
          </label>
          <button className="mt-5 h-9 rounded bg-teal-700 px-5 text-sm font-bold text-white hover:bg-teal-800" type="submit">검색</button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link className="rounded bg-slate-900 px-3 py-2 text-xs font-bold text-white" href="/fold-editor">새 템플릿 만들기</Link>
          {canEdit ? <button className="rounded border border-slate-300 px-3 py-2 text-xs font-bold" onClick={() => void addCategory()} type="button">분류 추가</button> : null}
        </div>
      </section>

      {error ? <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
      {message ? <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{message}</p> : null}

      <div className="grid gap-4 xl:grid-cols-[220px_minmax(360px,0.9fr)_minmax(460px,1.25fr)]">
        <aside className="rounded-lg border border-slate-300 bg-white p-3">
          <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-black">분류</h2><span className="text-xs text-slate-500">{categories.length}</span></div>
          <button className={`mb-1 w-full rounded px-3 py-2 text-left text-sm ${!categoryId ? "bg-teal-50 font-bold text-teal-800" : "hover:bg-slate-100"}`} onClick={() => applyCategoryFilter("")} type="button">전체</button>
          {categories.map((category) => (
            <div className="group flex items-center gap-1" key={category.id}>
              <button className={`min-w-0 flex-1 rounded px-3 py-2 text-left text-sm ${category.active ? "hover:bg-slate-100" : "text-slate-400"}`} onClick={() => applyCategoryFilter(category.id)} type="button">{category.name}</button>
              {canEdit ? <button aria-label={`${category.name} 분류 편집`} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100" onClick={() => void editCategory(category)} type="button">편집</button> : null}
            </div>
          ))}
        </aside>

        <section className="rounded-lg border border-slate-300 bg-white p-3">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-black">템플릿 목록</h2><span className="text-xs text-slate-500">{templates.length}건</span></div>
          {busy && templates.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">불러오는 중...</p> : null}
          {!busy && templates.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">조건에 맞는 템플릿이 없습니다.</p> : null}
          <div className="space-y-2">
            {templates.map((template) => (
              <button
                className={`w-full rounded border p-3 text-left hover:border-teal-500 ${selected?.templateId === template.templateId ? "border-teal-600 bg-teal-50" : "border-slate-200"}`}
                key={template.templateId}
                onClick={() => void openTemplate(template.templateId)}
                type="button"
              >
                <div className="flex items-start justify-between gap-2"><span className="font-bold">{template.name}</span>{template.currentRevision ? <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${statusClass[template.currentRevision.status]}`}>{statusLabel[template.currentRevision.status]}</span> : null}</div>
                <p className="mt-1 truncate font-mono text-[10px] text-slate-400">{template.code}</p>
                <p className="mt-2 text-xs text-slate-600">{template.category?.name ?? "미분류"} · {template.documentType.toUpperCase()} · 개정 {template.revisionCount}개</p>
              </button>
            ))}
          </div>
          {nextCursor ? <button className="mt-3 w-full rounded border border-slate-300 py-2 text-xs font-bold" disabled={busy} onClick={() => void loadTemplates({ ...appliedFilters, cursor: nextCursor }, true)} type="button">더 보기</button> : null}
        </section>

        <section className="rounded-lg border border-slate-300 bg-white p-4">
          {!selected ? <div className="flex min-h-80 items-center justify-center text-sm text-slate-500">템플릿을 선택하면 상세와 개정 이력을 표시합니다.</div> : (
            <div className="space-y-5">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-black">{selected.name}</h2>{current ? <span className={`rounded px-2 py-1 text-xs font-bold ${statusClass[current.status]}`}>{statusLabel[current.status]} r{current.revisionNumber}</span> : null}</div>
                <p className="mt-1 font-mono text-[10px] text-slate-400">{selected.code}</p>
              </div>

              {canEdit ? <div className="grid gap-2 sm:grid-cols-[1fr_180px_auto]">
                <input aria-label="템플릿 이름" className="field-control mt-0" onChange={(event) => setMetaName(event.target.value)} value={metaName} />
                <select aria-label="템플릿 분류" className="field-control mt-0" onChange={(event) => setMetaCategoryId(event.target.value)} value={metaCategoryId}><option value="">미분류</option>{activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
                <button className="rounded border border-slate-300 px-3 text-xs font-bold" disabled={busy} onClick={() => void runMutation(() => updateFoldTemplate({ templateId: selected.templateId, name: metaName, categoryId: metaCategoryId || null, expectedLockVersion: selected.lockVersion }), "템플릿 정보를 저장했습니다.")} type="button">정보 저장</button>
              </div> : null}

              <div className="flex flex-wrap gap-2">
                {current?.status === "DRAFT" ? <Link className="rounded bg-teal-700 px-3 py-2 text-xs font-bold text-white" href={`/fold-editor?draft=${current.revisionId}`}>초안 편집</Link> : null}
                {canEdit && current?.status === "DRAFT" ? <button className="rounded border border-blue-300 px-3 py-2 text-xs font-bold text-blue-800" onClick={() => void requestReview(current)} type="button">검토 요청</button> : null}
                {canPublish && current?.status === "REVIEW" ? <button className="rounded border border-amber-300 px-3 py-2 text-xs font-bold text-amber-800" onClick={() => void runMutation(() => transitionFoldRevision({ revisionId: current.revisionId, expectedLockVersion: current.lockVersion, action: "return" }), "초안을 수정 요청 상태로 돌렸습니다.")} type="button">수정 요청</button> : null}
                {canPublish && current?.status === "REVIEW" ? <button className="rounded bg-emerald-700 px-3 py-2 text-xs font-bold text-white" onClick={() => void publishRevision(current)} type="button">게시</button> : null}
                {canPublish && current?.status === "PUBLISHED" ? <button className="rounded border border-slate-400 px-3 py-2 text-xs font-bold" onClick={() => void retireRevision(current)} type="button">게시본 폐기</button> : null}
                {canEdit && current && (current.status === "PUBLISHED" || current.status === "RETIRED") ? <button className="rounded border border-teal-400 px-3 py-2 text-xs font-bold text-teal-800" onClick={() => void runMutation(() => createNextFoldRevision({ templateId: selected.templateId, sourceRevisionId: revisionDetail?.revisionId ?? current.revisionId, draftId: crypto.randomUUID() }), "새 작업 개정을 만들었습니다.")} type="button">선택 개정으로 새 초안</button> : null}
                {canEdit && current ? <button className="rounded border border-slate-300 px-3 py-2 text-xs font-bold" onClick={() => void copyTemplate(current)} type="button">다른 이름으로 복사</button> : null}
                {canEdit && current && selected.documentType === "normal" ? <button className="rounded border border-sky-300 px-3 py-2 text-xs font-bold text-sky-800" onClick={() => void copyTemplate(current, true)} type="button">패널 템플릿 만들기</button> : null}
                {canEdit && current?.status === "DRAFT" ? <button className="rounded border border-red-300 px-3 py-2 text-xs font-bold text-red-700" onClick={() => void discardDraft(current)} type="button">초안 취소</button> : null}
              </div>

              {revisionDetail ? <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"><div className="rounded bg-slate-50 p-2"><b>개정</b><br />r{revisionDetail.revisionNumber}</div><div className="rounded bg-slate-50 p-2"><b>재질</b><br />{revisionDetail.document.material.name}</div><div className="rounded bg-slate-50 p-2"><b>블록</b><br />{revisionDetail.document.blocks.length}</div><div className="rounded bg-slate-50 p-2"><b>선분</b><br />{revisionDetail.document.blocks.reduce((sum, block) => sum + block.segments.length, 0)}</div></div>
                <DocumentPreview document={revisionDetail.document} />
              </div> : null}

              <div>
                <h3 className="mb-2 text-sm font-black">개정 이력</h3>
                <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b text-slate-500"><th className="p-2">개정</th><th>상태</th><th>변경자</th><th>변경 시각</th></tr></thead><tbody>{selected.revisions.map((revision) => <tr className={`cursor-pointer border-b hover:bg-slate-50 ${revisionDetail?.revisionId === revision.revisionId ? "bg-teal-50" : ""}`} key={revision.revisionId} onClick={() => void changeRevision(revision)}><td className="p-2 font-bold">r{revision.revisionNumber}</td><td><span className={`rounded px-1.5 py-0.5 ${statusClass[revision.status]}`}>{statusLabel[revision.status]}</span></td><td>{revision.updatedBy?.displayName ?? "-"}</td><td>{formatDate(revision.statusChangedAt)}</td></tr>)}</tbody></table></div>
              </div>

              {selected.revisions.length >= 2 ? <div className="rounded border border-slate-200 p-3">
                <h3 className="mb-2 text-sm font-black">개정 비교</h3>
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  {[0, 1].map((index) => <select aria-label={index === 0 ? "비교 왼쪽 개정" : "비교 오른쪽 개정"} className="field-control mt-0" key={index} onChange={(event) => setCompareIds((currentIds) => index === 0 ? [event.target.value, currentIds[1]] : [currentIds[0], event.target.value])} value={compareIds[index]}><option value="">개정 선택</option>{selected.revisions.map((revision) => <option key={revision.revisionId} value={revision.revisionId}>r{revision.revisionNumber} {statusLabel[revision.status]}</option>)}</select>)}
                  <button className="rounded border border-slate-300 px-3 text-xs font-bold" onClick={() => void compareRevisions()} type="button">비교</button>
                </div>
                {compareDetails ? <div className="mt-3"><p className="mb-2 text-xs font-bold">차이 {differences.length}개</p>{differences.length === 0 ? <p className="text-xs text-slate-500">저장 문서 내용이 같습니다.</p> : <div className="max-h-64 overflow-auto rounded bg-slate-950 p-3 font-mono text-[11px] text-slate-100">{differences.slice(0, 200).map((difference) => <div className="mb-2" key={difference.path}><div className="text-teal-300">{difference.path}</div><div>- {difference.left}</div><div>+ {difference.right}</div></div>)}</div>}</div> : null}
              </div> : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
