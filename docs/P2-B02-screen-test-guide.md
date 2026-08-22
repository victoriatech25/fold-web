# P2-B02 파일 저장소 화면 테스트 가이드

> 대상: [P2-B02 상세계획](./work-items/P2-B02-file-storage.md)
>
> 작성일: 2026-08-22
>
> 검수자: 사용자 본인

`P2-B02`는 기반 작업이라 파일을 올리고 내려받는 **화면이 아직 없다.** 사용자용 진입점은 이 저장소를 쓰는 `P2-B09` 대량 DXF와 수주 첨부에서 만든다. 그래서 이번 검수는 `P2-B01`과 같이 브라우저 콘솔에서 API를 직접 호출해 확인한다.

## 1. 준비

터미널 세 개를 쓴다.

```bash
docker compose up -d storage
```

```bash
npm run dev
```

```bash
npm run worker
```

- 웹: `http://localhost:8000`
- MinIO 콘솔: `http://127.0.0.1:9001` (`fold-web-local` / `fold-web-local-secret`)
- 계정 정보는 [로컬 화면 테스트 계정](./local-screen-test-account.md)에 있다

**콘솔 코드는 반드시 서비스 화면(`localhost:8000`)에서 실행한다.** 서버가 요청 출처를 검사한다. 처음 붙여넣을 때 Chrome이 막으면 콘솔에 `allow pasting`을 직접 입력한 뒤 Enter를 누른다.

아래 검수에서 공통으로 쓰는 도우미다. 한 번 실행해 둔다.

```javascript
window.t = {
  async sha256(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  },
  async api(path, method = "GET", body) {
    const response = await fetch(path, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  },
};
```

## 2. 검수 항목

### 2-1. DXF 바이트가 실제로 보관된다

`P2-B01`까지는 DXF를 만들어도 바이트를 버렸다(`contentRetained: false`). 이제 보관한다.

먼저 `설계·도면` → `템플릿`에서 게시된 절곡 개정을 열고 주소창의 개정 ID를 복사한다. 그 ID로 작업을 등록한다.

```javascript
await t.api("/api/v1/jobs", "POST", {
  type: "dxf.export",
  payload: { revisionId: "게시된 절곡 개정 ID" },
  idempotencyKey: "b02-check-1",
});
```

기대 결과

- `생산·출력` → `작업 큐`에서 작업이 `완료`가 된다.
- 결과에 **`"contentRetained": true`** 가 있다. 이것이 이번 작업의 핵심이다.
- MinIO 콘솔의 bucket에 `generated/{조직ID}/dxf/{checksum}.dxf` 객체가 보인다.

### 2-2. 보관한 DXF를 다운로드 URL로 받는다

2-1 결과의 `assetId`를 쓴다.

```javascript
const ticket = await t.api("/api/v1/files/작업결과의_assetId/downloads", "POST");
ticket.data.data.download.url;
```

기대 결과

- `expiresAt`이 지금부터 약 5분 뒤다.
- URL을 새 탭에서 열면 DXF 파일이 원래 이름으로 내려받아진다. 한글 파일명이 깨지지 않는다.
- 같은 개정을 편집기에서 직접 DXF로 내보낸 파일과 내용이 같다.

### 2-3. 만료된 URL로는 받을 수 없다

2-2에서 받은 URL을 그대로 두고 **5분이 지난 뒤** 다시 연다.

기대 결과

- 파일이 내려오지 않고 오류가 뜬다. 새로 발급해야 받을 수 있다.

### 2-4. 업로드 시작 → 올리기 → 완료

첨부 파일(`OTHER` 종류)을 올린다.

```javascript
const text = "검수용 첨부 파일";
const started = await t.api("/api/v1/files/uploads", "POST", {
  kind: "OTHER",
  fileName: "검수첨부.txt",
  mediaType: "text/plain",
  sizeBytes: new TextEncoder().encode(text).length,
  checksumSha256: await t.sha256(text),
});
const fileId = started.data.data.file.id;

await fetch(started.data.data.upload.url, {
  method: "PUT",
  headers: { "content-type": "text/plain" },
  body: text,
});

await t.api(`/api/v1/files/${fileId}/complete`, "POST");
```

기대 결과

- 시작 응답의 `status`가 `PENDING`이고 `upload.url`이 함께 온다.
- 완료 응답의 `status`가 `READY`로 바뀐다.
- `시스템` → `감사 로그`에서 `파일 업로드 완료`가 보인다. 파일 내용은 로그에 없다.

### 2-5. 올리지 않고 완료를 요청하면 READY가 되지 않는다

2-4의 첫 두 줄만 실행하고(업로드 PUT을 건너뛴다) 바로 완료를 요청한다.

기대 결과

- `409`와 `업로드가 아직 끝나지 않았습니다.`가 돌아온다.
- 파일은 `PENDING`으로 남는다.

### 2-6. 선언한 내용과 다른 것을 올리면 거부한다

길이는 같고 내용만 다르게 올린다.

```javascript
const declared = "AAAAAAAAAA";
const actual = "BBBBBBBBBB";
const started = await t.api("/api/v1/files/uploads", "POST", {
  kind: "OTHER",
  fileName: "불일치.txt",
  mediaType: "text/plain",
  sizeBytes: 10,
  checksumSha256: await t.sha256(declared),
});
await fetch(started.data.data.upload.url, {
  method: "PUT",
  headers: { "content-type": "text/plain" },
  body: actual,
});
await t.api(`/api/v1/files/${started.data.data.file.id}/complete`, "POST");
```

기대 결과

- `409`와 `checksum·크기와 일치하지 않습니다`가 돌아온다.
- MinIO 콘솔에서 그 객체가 지워져 있다. 깨진 바이트를 남기지 않는다.
- 감사 로그에 `파일 업로드 거부`가 남는다.

크기까지 다르게 올리면 그 전에 저장소가 먼저 거절한다. presigned URL 서명에 선언한 크기가 들어가기 때문이다.

### 2-7. 허용하지 않는 종류와 형식은 막는다

```javascript
await t.api("/api/v1/files/uploads", "POST", {
  kind: "DXF",
  fileName: "직접만든.dxf",
  mediaType: "application/dxf",
  sizeBytes: 10,
  checksumSha256: await t.sha256("x"),
});
```

기대 결과

- `400`이 돌아온다. `DXF`는 서버가 만드는 파일이라 직접 올릴 수 없다.
- `fileName`을 `실행파일.exe`, `mediaType`을 `application/octet-stream`으로 바꿔도 `400`이다.

### 2-8. 삭제는 표시만 하고 객체는 남는다

2-4에서 올린 파일을 지운다.

```javascript
await t.api(`/api/v1/files/${fileId}`, "DELETE");
await t.api(`/api/v1/files/${fileId}`);
```

기대 결과

- 삭제 응답의 `status`가 `DELETED`다.
- 이어진 조회는 `404`다. 화면에서 사라진다.
- **MinIO 콘솔에는 객체가 그대로 있다.** 유예 30일 안에는 되돌릴 수 있다.
- 감사 로그에 `파일 삭제`가 남고 `purgeAfter`(30일 뒤)가 적혀 있다.

### 2-9. 정리 작업이 유예가 끝난 것만 지운다

정리를 queue 작업으로 돌린다. 유예를 `0`으로 주면 방금 지운 것도 대상이 된다.

```javascript
await t.api("/api/v1/jobs", "POST", {
  type: "storage.cleanup",
  payload: { graceDays: 0 },
  idempotencyKey: "b02-cleanup-1",
});
```

기대 결과

- `작업 큐`에 `파일 저장소 정리`가 나타나고 `완료`가 된다.
- 결과에 `purgedDeleted`가 1 이상이다.
- 2-8의 객체가 MinIO 콘솔에서 사라진다. **`FileAsset` 행은 남는다** — 무엇이 있었는지 추적할 수 있어야 한다.
- 감사 로그에 `파일 실제 삭제`가 남는다.
- 2-1에서 만든 DXF는 그대로 있다. 삭제 표시가 없으므로 대상이 아니다.

기본값(`payload: {}`)으로 실행하면 아무것도 지워지지 않아야 한다. 유예 30일·보존 90일이 지난 파일이 아직 없기 때문이다.

### 2-10. 저장소가 죽어도 DXF 출력은 멈추지 않는다

저장소를 내린 뒤 편집기에서 DXF를 내보낸다.

```bash
docker compose stop storage
```

기대 결과

- **DXF 파일은 평소대로 내려받아진다.** 업무가 멈추지 않는다.
- 서버 로그에 `DXF storage write failed`가 찍힌다.
- 그 파일의 다운로드 URL 요청은 `409`다. 바이트가 보관되지 않아 아직 받을 수 없는 상태(`PENDING`)다.

확인이 끝나면 다시 올린다.

```bash
docker compose start storage
```

같은 개정을 다시 내보내면 이번에는 보관되어 `READY`가 된다.

### 2-11. 남의 조직·권한 없는 사용자

`admin.manage` 권한이 없고 `order.read`만 가진 계정으로 로그인해 2-2의 다운로드 URL 발급을 요청한다.

기대 결과

- 조회 권한만 있으면 다운로드는 되지만 삭제(`DELETE`)는 `403`이다. 지우는 것은 올릴 수 있는 사람만 한다.
- 다른 조직 계정으로는 같은 `fileId`에 `404`가 돌아온다. 파일이 있다는 사실 자체를 알려주지 않는다.

## 3. 실패 기록 양식

| 항목 | 내용 |
|---|---|
| 검수 항목 번호 |  |
| 재현 단계 |  |
| 기대 결과 |  |
| 실제 결과 |  |
| 서버·worker 로그 |  |
| MinIO 콘솔 상태 |  |
