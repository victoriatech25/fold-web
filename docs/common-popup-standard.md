# 공통 팝업 구현 기준

> 확정일: 2026-07-25
>
> 상태: `APPROVED`
>
> 적용 범위: `fold_web` 전체 화면

## 1. 공식 기준

애플리케이션에서 사용자에게 표시하는 알림, 작업 확인, 한 줄 문자 입력 팝업은 브라우저 기본 `window.alert`, `window.confirm`, `window.prompt`를 사용하지 않는다. 모든 신규·기존 화면은 `CommonPopupProvider`와 `useCommonPopup`을 사용한다.

기능성 모달도 제목·닫기·본문·footer·초점 관리가 필요한 경우 `CommonDialog`를 공통 외형으로 사용한다.

## 2. 제공 유형

| 유형 | API | 용도 | 반환 |
|---|---|---|---|
| 알림 | `alert(options)` | 사용자가 내용을 확인해야 하는 안내 | `Promise<void>` |
| 확인 | `confirm(options)` | 게시·삭제·비활성화 등 실행 여부 확인 | `Promise<boolean>` |
| 문자 입력 | `prompt(options)` | 분류명·복사명처럼 한 줄 값을 받는 작업 | `Promise<string \| null>` |
| 기능 모달 | `CommonDialog` | 새 초안·최근 목록 등 복합 콘텐츠 | React children |

## 3. UX·접근성 규칙

- 한국어 제목, 영향이 드러나는 설명, 구체적인 실행 버튼명을 사용한다.
- 단순 `확인`보다 `게시`, `삭제`, `비활성화`처럼 실제 행위를 버튼에 표시한다.
- 정보는 teal, 주의는 amber, 파괴적 작업은 red variant를 사용한다.
- 파괴적 작업은 취소 버튼을 함께 제공하고 기본 초점은 실행 버튼 또는 입력창에 둔다.
- `role=dialog` 또는 `role=alertdialog`, `aria-modal`, 제목·설명 연결을 유지한다.
- Esc 닫기, Tab 초점 순환, 닫은 뒤 기존 요소로 초점 복원을 제공한다.
- 팝업이 열린 동안 본문 스크롤을 잠근다.
- 여러 요청이 동시에 발생하면 공통 Provider queue 순서로 하나씩 표시한다.
- API·validation 오류처럼 사용자가 현재 문맥에서 바로 수정해야 하는 내용은 해당 form의 inline 오류를 우선 사용한다. 별도 확인이 필요한 경우에만 공통 알림을 사용한다.

## 4. 구현 위치

- 전역 등록: `src/app/layout.tsx`
- 공통 구현: `src/components/ui/common-popup.tsx`
- 사용: client component에서 `useCommonPopup()` 호출

```tsx
const { confirm } = useCommonPopup();

const approved = await confirm({
  title: "개정 게시",
  message: "이 개정을 게시본으로 확정하시겠습니까?",
  confirmText: "게시",
  variant: "warning",
});
```

## 5. 금지·검증

- `src` 아래 `window.alert`, `window.confirm`, `window.prompt`와 전역 `alert`, `confirm`, `prompt` 직접 호출을 금지한다.
- 코드 검토와 CI에서 정적 검색으로 직접 호출이 0건인지 확인한다.
- Playwright는 브라우저 `dialog` event 대신 공통 `dialog/alertdialog`와 버튼을 검증한다.
- 예외는 저장되지 않은 편집 내용이 있는 상태에서 탭 종료·새로고침을 막는 표준 `beforeunload` 경고다. 브라우저가 제어하는 이 경고는 애플리케이션 DOM 팝업으로 대체할 수 없으며 화면 내부 작업 확인에는 사용하지 않는다.
