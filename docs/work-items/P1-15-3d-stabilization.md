# P1-15 — 3D 검토 안정화

> 상태: `DONE` (2026-07-26)
>
> 담당·검수: 사용자 본인
>
> MFC 참조 프로젝트: `/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면`

## 완료 범위

- 2D 선택 segment ID를 3D surface/solid range까지 유지해 선택 동기화를 보존했다.
- 직선 chord로 보이던 원호를 최대 8° 간격으로 샘플링해 3D 형상에 반영했다. 샘플들은 원본 segment ID를 공유하므로 선택 의미는 변하지 않는다.
- 판 두께와 안쪽 절곡 반경을 적용하고, 인접 구간보다 큰 반경은 안전한 값으로 제한하면서 경고한다.
- 비인접 구간의 내부 교차를 탐지해 `PROFILE_SELF_INTERSECTION` 경고를 표시한다.
- 박스는 두 단면의 교차 직선을 자동 판정하고 제품 길이 없이 바닥 가로·세로만으로 3D를 생성한다. 교차 직선 쌍이 없을 때만 명시적 오류를 표시한다.

## 한계

3D는 제작 솔리드 커널이 아니라 시각 검토 모델이다. 두께 offset의 모든 국부 충돌, 실제 절곡 순서, springback, STEP 생성은 P2 이후 범위다. WebGL/GPU 환경의 픽셀 결과는 사용자 화면 검수 대상으로 유지한다.
