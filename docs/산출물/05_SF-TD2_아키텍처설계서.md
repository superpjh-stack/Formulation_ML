# SF-TD2 아키텍처설계서

| 항목 | 내용 |
|------|------|
| 문서번호 | SF-TD2 |
| 문서명 | 아키텍처설계서 |
| 사업명 | 성분분석 데이터 기반 배합비율 최적화 ML 시스템 구축 |
| 도입기업 | (주)고려솔더 |
| 작성자 | 이성민 |
| 검토자 | 장다운 |
| 승인자 | 김현수 |
| 작성일 | 2026-04-21 |
| 버전 | v1.0 |

---

## 1. 시스템 아키텍처

### 1.1 전체 구성도

```
┌─────────────────────────────────────────────────────────────────┐
│                         클라이언트                              │
│  [Chrome Browser]                                               │
│  - 일반 PC / 태블릿 (1920×1080 기준)                           │
└────────────────────┬────────────────────────────────────────────┘
                     │ HTTPS (TLS 1.2+)
┌────────────────────▼────────────────────────────────────────────┐
│                    프론트엔드 서버                              │
│  [Next.js 14 App Router]                                        │
│  - TypeScript 5.x                                               │
│  - 44개 화면 (10개 섹션)                                       │
│  - React Server Components + Client Components                  │
│  - 포트: 3000                                                   │
└────────────────────┬────────────────────────────────────────────┘
                     │ REST API (JSON)
┌────────────────────▼────────────────────────────────────────────┐
│                    백엔드 API 서버                              │
│  [FastAPI + Uvicorn]                                            │
│  - Python 3.10+                                                 │
│  - RESTful API (OpenAPI 3.0 자동 문서화)                       │
│  - JWT 인증 미들웨어                                           │
│  - 포트: 8000                                                   │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  API Router  │  │  ML Engine   │  │  Auth & RBAC         │  │
│  │  /api/v1/    │  │  scikit-learn│  │  JWT + Role          │  │
│  │  predict     │  │  XGBoost     │  │  관리자/제조/품질/   │  │
│  │  recommend   │  │  scipy SLSQP │  │  영업                │  │
│  │  eda-stats   │  │              │  │                      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└──────────┬──────────────────┬───────────────────────────────────┘
           │                  │
┌──────────▼──────┐  ┌────────▼────────────────────────────────┐
│  PostgreSQL 15  │  │  파일 스토리지                          │
│  (포트: 5432)   │  │  [ML 모델 아티팩트]                    │
│                 │  │  - models/artifacts/*.joblib             │
│  테이블:        │  │  - preprocessors_*.joblib               │
│  - lots         │  │  [CSV 학습 데이터]                      │
│  - components   │  │  - data/raw/*.csv                       │
│  - quality      │  │  - data/processed/*.csv                 │
│  - equipment    │  │                                         │
│  - users        │  └─────────────────────────────────────────┘
│  - alerts       │
└─────────────────┘
```

### 1.2 네트워크 구성도

```
[인터넷]
    │
  [방화벽 (UFW)]
    │ 443(HTTPS), 80(HTTP→리다이렉트)만 허용
    │
[Nginx Reverse Proxy]
    │ /         → Next.js :3000
    │ /api/v1/  → FastAPI :8000
    │ SSL 종단 (Let's Encrypt 또는 사내 CA)
    │
[Docker Bridge Network (koryo-net)]
    ├── [next-app]     :3000
    ├── [fastapi-app]  :8000
    └── [postgres-db]  :5432 (내부 접근만 허용)
```

---

## 2. 하드웨어 구성

### 2.1 서버 사양

| 구분 | 서버명 | CPU | RAM | Storage | OS | 역할 |
|------|--------|-----|-----|---------|-----|------|
| 애플리케이션 | APP-SRV-01 | Intel Xeon 16코어 | 32GB | SSD 512GB | Ubuntu 22.04 LTS | Next.js + FastAPI + Nginx |
| 데이터베이스 | DB-SRV-01 | Intel Xeon 8코어 | 16GB | SSD 1TB | Ubuntu 22.04 LTS | PostgreSQL 15 |
| ML 학습 | ML-SRV-01 | AMD EPYC 8코어 | 32GB | SSD 256GB | Ubuntu 22.04 LTS | 모델 재학습 (배치) |

### 2.2 클라이언트 환경

| 구분 | 사양 | 브라우저 | 수량 |
|------|------|---------|------|
| 사무용 PC | Windows 10/11, i5, 8GB | Chrome 최신 | 15대 |
| 제조동 PC | Windows 10, i5, 8GB | Chrome 최신 | 3대 |
| 품질동 PC | Windows 10, i5, 8GB | Chrome 최신 | 2대 |

---

## 3. 소프트웨어 스택

### 3.1 프론트엔드

| 구분 | 기술/버전 | 용도 |
|------|-----------|------|
| 프레임워크 | Next.js 14.2 (App Router) | SPA/SSR 웹 애플리케이션 |
| 언어 | TypeScript 5.4 | 타입 안전 개발 |
| UI 라이브러리 | React 18.3 | 컴포넌트 기반 UI |
| 스타일링 | CSS-in-JS (inline styles) | 디자인 시스템 |
| 폰트 | Pretendard | 한국어 최적화 |
| 차트 | SVG (MiniSparkline) | 경량 차트 |
| 상태관리 | React Hooks (useState, useEffect) | 로컬 상태 |

### 3.2 백엔드

| 구분 | 기술/버전 | 용도 |
|------|-----------|------|
| 프레임워크 | FastAPI 0.111 | REST API 서버 |
| 런타임 | Python 3.10+ | 백엔드 + ML |
| ASGI 서버 | Uvicorn 0.29 | 고성능 비동기 서버 |
| ORM | SQLAlchemy 2.0 | DB 접근 |
| 인증 | python-jose (JWT) | 토큰 기반 인증 |

### 3.3 ML 스택

| 구분 | 라이브러리/버전 | 용도 |
|------|----------------|------|
| ML 프레임워크 | scikit-learn 1.4 | RandomForest, GradientBoosting, Ridge |
| 앙상블 | XGBoost 2.0 | XGBoost 모델 |
| 최적화 | scipy 1.12 (SLSQP) | 배합비율 최적화 |
| 데이터 처리 | pandas 2.2, numpy 1.26 | 데이터 전처리 |
| 모델 직렬화 | joblib 1.3 | 모델 저장/로드 |
| EDA | matplotlib 3.8 | 분포/상관 시각화 |

### 3.4 인프라

| 구분 | 기술/버전 | 용도 |
|------|-----------|------|
| 컨테이너 | Docker 26, Docker Compose 2 | 서비스 격리/배포 |
| 웹서버 | Nginx 1.26 | 리버스 프록시, SSL |
| 데이터베이스 | PostgreSQL 15 | 관계형 데이터 저장 |
| 버전관리 | Git + GitHub | 소스 코드 관리 |
| CI/CD | GitHub Actions | 자동 빌드/배포 |

---

## 4. ML 모델 아키텍처

### 4.1 모델 학습 파이프라인

```
[원본 데이터 (CSV)]
  formulation_history.csv
  - LOT ID, 날짜, 공급사
  - Sn/Ag/Cu/Pb 비율
  - 온도, 시간
  - 품질 점수 (target)
       │
       ▼
[Feature Engineering (src/features/engineering.py)]
  피처 생성:
  - sn_deviation = Sn - 62.0 (목표값 대비 편차)
  - ag_deviation = Ag - 3.0
  - cu_deviation = Cu - 0.5
  불순물 처리: SimpleImputer (median)
  스케일링: StandardScaler
  → 저장: preprocessors_{name}.joblib
       │
       ▼
[모델 학습 (src/models/train.py)]
  REGISTRY:
  ├── ridge: Ridge(alpha=1.0)
  ├── random_forest: RandomForestRegressor(n_estimators=200)
  ├── gradient_boosting: GradientBoostingRegressor(n_estimators=200)
  └── xgboost: XGBRegressor(n_estimators=200)
  
  교차검증: 5-Fold CV
  성능 평가: MAE, RMSE, R², MAPE
  → 저장: {name}.joblib
       │
       ▼
[배포 (FastAPI /api/v1/predict)]
  - 모델 로드: {name}.joblib
  - 전처리기 로드: preprocessors_{name}.joblib
  - 추론: model.predict(X)
  - 응답: {"quality_score": float, "model": str}
```

### 4.2 배합 최적화 파이프라인

```
[입력]
  - 온도 (temperature): float
  - 시간 (time): int
  - 공급사 (supplier): str
  - 사용 모델: str
       │
       ▼
[최적화 엔진 (src/models/optimize.py)]
  알고리즘: scipy.optimize.minimize (method='SLSQP')
  
  목적 함수: -predict(x)  [최대화 = 최소화(-)]
  
  제약 조건:
  - eq: sn + ag + cu + pb = 100.0
  - bounds: Sn (55~70), Ag (1~5), Cu (0.1~1.5), Pb (25~45)
  
  초기값: [62.0, 3.0, 0.5, 34.5]
       │
       ▼
[출력]
  - 최적 Sn/Ag/Cu/Pb 비율 (%)
  - 예상 품질 점수
  - 최적화 성공 여부
```

### 4.3 모델 성능 기준선 (샘플 데이터)

| 모델 | MAE | RMSE | R² | MAPE |
|------|-----|------|----|------|
| Ridge | 3.98 | 4.82 | 0.421 | 4.62% |
| RandomForest | 2.71 | 3.21 | 0.588 | 3.03% |
| **GradientBoosting** | **2.53** | **3.05** | **0.627** | **2.78%** |
| XGBoost | 2.80 | 3.38 | 0.551 | 3.21% |

> 최고 성능: GradientBoosting (RMSE=3.05, R²=0.627)  
> 실데이터 도입 후 R² ≥ 0.85 목표

---

## 5. 설비 조달 계획

| 항목 | 수량 | 단가 (추정) | 합계 | 비고 |
|------|------|-------------|------|------|
| 애플리케이션 서버 | 1대 | 8,000,000원 | 8,000,000원 | |
| 데이터베이스 서버 | 1대 | 6,000,000원 | 6,000,000원 | |
| ML 학습 서버 | 1대 | 7,000,000원 | 7,000,000원 | |
| UPS (무정전전원장치) | 2대 | 1,500,000원 | 3,000,000원 | |
| 네트워크 스위치 | 1대 | 500,000원 | 500,000원 | |
| **합계** | | | **24,500,000원** | |

---

## 6. 클라우드/외부 서비스

| 서비스 | 용도 | 비고 |
|--------|------|------|
| GitHub | 소스코드 저장소, CI/CD | 무료 플랜 |
| Let's Encrypt | SSL 인증서 | 무료, 자동 갱신 |
| SMTP 서버 | 이상 알림 이메일 발송 | 기존 사내 SMTP 활용 |

> 클라우드(AWS/Azure) 비사용 — 사내 on-premise 구성으로 데이터 보안 강화
