# Plan: streamlit-dashboard

> 작성일: 2026-06-17 | 담당: Formulation ML

## 1. 목표

`app.py` (Streamlit) 을 작성하여 배합비율 최적화 ML 시스템의 주요 기능을
웹 UI로 제공한다. 비기술자(현장 담당자)도 신규 LOT 배합 추천과 품질 예측을
직접 조작할 수 있도록 한다.

## 2. 배경 & 문제

- 현재 모든 기능이 CLI(`scripts/`)로만 제공 → 현장 사용 불가
- EDA 결과(노트북)를 별도 실행 없이 확인할 방법이 없음
- 배합 추천 결과를 테이블/차트로 시각화하는 인터페이스 부재

## 3. 범위 (Scope)

### In-scope

| # | 페이지/기능 | 설명 |
|---|------------|------|
| 1 | 홈 (개요) | 시스템 소개 + 빠른 통계 (데이터 건수, 모델 성능) |
| 2 | 배합 추천 | 공정 조건 입력 → 최적 배합비율 출력 + 품질 예측 |
| 3 | 배치 예측 | CSV 업로드 → 품질점수 예측 결과 다운로드 |
| 4 | 데이터 탐색 | 주요 EDA 차트 (분포, 상관관계, 공급사별 품질) |
| 5 | 모델 정보 | 피처 중요도 + 교차검증 성능 지표 |

### Out-of-scope

- 모델 재학습 UI (CLI 전용 유지)
- 사용자 인증 / 권한 관리
- 실시간 PLC 연동
- 배포 (Docker/Cloud) — 로컬 실행만

## 4. 요구사항

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| FR-ST-01 | `streamlit run app.py` 단일 명령으로 실행 | 필수 |
| FR-ST-02 | 사이드바 네비게이션 (5개 페이지) | 필수 |
| FR-ST-03 | 배합 추천: 온도/시간/공급사 입력 → 추천 결과 표시 | 필수 |
| FR-ST-04 | 배합 추천 결과: 성분 비율 bar chart + 품질 점수 | 필수 |
| FR-ST-05 | 배치 예측: CSV 업로드 → 결과 테이블 + 다운로드 | 필수 |
| FR-ST-06 | 데이터 탐색: quality_score 분포 + 상관관계 heatmap | 필수 |
| FR-ST-07 | 모델 정보: 피처 중요도 bar chart | 필수 |
| FR-ST-08 | 모델/데이터 파일 없을 때 명확한 안내 메시지 | 필수 |
| FR-ST-09 | `src/` 모듈 재사용 (loader, engineering, optimize) | 필수 |
| FR-ST-10 | 공급사 선택 드롭다운 (데이터에서 자동 추출) | 권장 |

### 성능 요구사항

| 항목 | 목표 |
|------|------|
| 배합 추천 응답 | ≤ 3초 |
| 배치 예측 (300건) | ≤ 5초 |
| 페이지 로드 | ≤ 2초 |

## 5. 산출물

```
app.py                     ← Streamlit 메인 앱 (신규)
requirements.txt           ← streamlit 추가
```

## 6. 선행 조건

- `models/artifacts/gradient_boosting.joblib` 존재
- `models/artifacts/preprocessors_gradient_boosting.joblib` 존재
- `data/raw/formulation_history.csv` 존재

## 7. 기술 스택

| 항목 | 선택 | 이유 |
|------|------|------|
| UI 프레임워크 | Streamlit | 설치 단순, ML 결과 시각화 특화 |
| 차트 | matplotlib / plotly | matplotlib 기존 사용, plotly는 인터랙티브 |
| 차트 방침 | matplotlib 우선, 인터랙티브 필요 시 plotly | 의존성 최소화 |

## 8. 일정

| 단계 | 작업 |
|------|------|
| Design | 페이지별 UI 레이아웃 + 컴포넌트 설계 |
| Do | `app.py` 구현 (5개 페이지 순차 작성) |
| Check | `streamlit run app.py` 실행 후 기능별 동작 확인 |
