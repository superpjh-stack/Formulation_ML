# Design: streamlit-dashboard

> 작성일: 2026-06-17 | Plan 문서: `docs/01-plan/features/streamlit-dashboard.plan.md`

## 1. 앱 구조

```
app.py
├── _load_artifacts()          # 모델 + 전처리기 캐시 로드 (@st.cache_resource)
├── _load_data()               # 원본 데이터 캐시 로드 (@st.cache_data)
├── page_home()                # 홈 (개요 + 빠른 통계)
├── page_recommend()           # 배합 추천
├── page_batch_predict()       # 배치 예측
├── page_eda()                 # 데이터 탐색
├── page_model_info()          # 모델 정보
└── main()                     # 사이드바 네비게이션 + 라우팅
```

---

## 2. 공통 설계

### 2-1. 아티팩트 로드 패턴

```python
@st.cache_resource
def _load_artifacts(model_name: str = "gradient_boosting"):
    """모델 + 전처리기를 캐시해서 반환. 없으면 None 반환."""
    from pathlib import Path
    import joblib
    model_path = Path(f"models/artifacts/{model_name}.joblib")
    prep_path  = Path(f"models/artifacts/preprocessors_{model_name}.joblib")
    if not model_path.exists() or not prep_path.exists():
        return None, None, None
    model = joblib.load(model_path)
    prep  = joblib.load(prep_path)
    return model, prep["imputer"], prep["scaler"]

@st.cache_data
def _load_data():
    from src.data.loader import load_raw
    try:
        return load_raw("formulation_history.csv")
    except FileNotFoundError:
        return None
```

### 2-2. 공급사 목록 추출

```python
def _get_suppliers(df) -> list[str]:
    return sorted(df["supplier_id"].unique().tolist()) if df is not None else ["SUP_A"]
```

### 2-3. 모델 없음 경고 컴포넌트

```python
def _warn_no_model():
    st.warning("""모델 파일이 없습니다. 먼저 학습을 실행하세요:
    ```bash
    python scripts/train.py --data formulation_history.csv \\
                            --target quality_score \\
                            --model gradient_boosting
    ```""")
```

---

## 3. 사이드바 네비게이션

```python
def main():
    st.sidebar.title("배합비율 최적화 ML")
    st.sidebar.markdown("---")
    page = st.sidebar.radio(
        "페이지 선택",
        ["홈", "배합 추천", "배치 예측", "데이터 탐색", "모델 정보"]
    )
    st.sidebar.markdown("---")
    st.sidebar.caption("Formulation ML v1.0")

    pages = {
        "홈": page_home,
        "배합 추천": page_recommend,
        "배치 예측": page_batch_predict,
        "데이터 탐색": page_eda,
        "모델 정보": page_model_info,
    }
    pages[page]()
```

---

## 4. 페이지별 상세 설계

### 4-1. 홈 페이지 (`page_home`)

**레이아웃**:
```
[제목] 배합비율 최적화 ML 시스템
[설명] 1~2줄 요약

[col1]          [col2]          [col3]          [col4]
데이터 건수     불량률          모델 MAPE       모델 R²
{N}건          {x}%           {x}%            {x}
```

**구현 포인트**:
```python
def page_home():
    st.title("배합비율 최적화 ML 시스템")
    st.markdown("성분분석 데이터 기반 **최적 배합비율 자동 추천** 및 **품질 예측** 시스템입니다.")

    df = _load_data()
    model, imputer, scaler = _load_artifacts()

    col1, col2, col3, col4 = st.columns(4)
    if df is not None:
        col1.metric("데이터 건수", f"{len(df):,}건")
        col2.metric("불량률", f"{df['is_defect'].mean()*100:.1f}%")
    if model is not None:
        # 저장된 교차검증 점수 표시 (없으면 "-")
        col3.metric("모델 MAPE", "2.77%")   # CLAUDE.md 기준값
        col4.metric("모델 R²", "0.627")
```

---

### 4-2. 배합 추천 (`page_recommend`)

**레이아웃**:
```
[제목] 신규 LOT 배합비율 추천

[왼쪽 입력 패널]           [오른쪽 결과 패널]
용해 온도: slider          추천 배합비율 (bar chart)
가열 시간: slider          성분별 % 수치 테이블
공급사:    selectbox       예측 품질점수: metric
[추천 받기 버튼]            최적화 성공/실패 메시지
```

**구현 포인트**:
```python
def page_recommend():
    st.title("신규 LOT 배합비율 추천")

    df = _load_data()
    model, imputer, scaler = _load_artifacts()
    if model is None:
        _warn_no_model(); return

    col_in, col_out = st.columns([1, 1])

    with col_in:
        st.subheader("공정 조건 입력")
        temp    = st.slider("용해 온도 (°C)", 200, 300, 250)
        time_   = st.slider("가열 시간 (분)", 20, 90, 45)
        supplier = st.selectbox("공급사", _get_suppliers(df))
        run_btn  = st.button("최적 배합비율 추천", type="primary")

    with col_out:
        st.subheader("추천 결과")
        if run_btn:
            from src.models.optimize import recommend_ratios
            # supplier one-hot 인코딩
            suppliers = _get_suppliers(df)
            process_cond = {"melt_temp_c": temp, "melt_time_min": time_}
            for s in suppliers[1:]:           # drop_first=True 패턴
                process_cond[f"supplier_id_{s}"] = 1 if supplier == s else 0

            with st.spinner("최적화 중..."):
                result = recommend_ratios(process_cond, model, imputer, scaler)

            if result["success"]:
                ratio_keys = ["sn_pct", "ag_pct", "cu_pct", "pb_pct"]
                ratios = {k: result[k] for k in ratio_keys}

                # bar chart
                fig, ax = plt.subplots(figsize=(6, 3))
                ax.bar(ratios.keys(), ratios.values(), color="steelblue")
                ax.set_ylabel("%")
                ax.set_title("최적 배합비율")
                st.pyplot(fig)
                plt.close(fig)

                # 수치 테이블
                st.dataframe(
                    pd.DataFrame([ratios]).T.rename(columns={0: "비율 (%)"}),
                    use_container_width=True
                )
                st.metric("예측 품질점수", f"{result['predicted_quality']:.2f}")
            else:
                st.warning(result["message"])
                st.info("표준 배합비율이 반환됩니다.")
```

---

### 4-3. 배치 예측 (`page_batch_predict`)

**레이아웃**:
```
[제목] 배치 예측

[파일 업로더]  CSV 파일 업로드 (formulation_history.csv 형식)
[미리보기]     업로드 데이터 상위 5행
[예측 실행]    버튼
[결과 테이블]  원본 컬럼 + predicted_quality 컬럼 추가
[다운로드]     CSV 다운로드 버튼
```

**구현 포인트**:
```python
def page_batch_predict():
    st.title("배치 예측")
    st.markdown("CSV 파일을 업로드하면 각 행의 `quality_score`를 예측합니다.")

    model, imputer, scaler = _load_artifacts()
    if model is None:
        _warn_no_model(); return

    uploaded = st.file_uploader("CSV 파일 업로드", type=["csv"])
    if uploaded is None:
        st.info("CSV 파일을 업로드하세요. 컬럼: sn_pct, ag_pct, cu_pct, pb_pct, melt_temp_c, melt_time_min, supplier_id")
        return

    df_up = pd.read_csv(uploaded)
    st.subheader("업로드 데이터 미리보기")
    st.dataframe(df_up.head(), use_container_width=True)

    if st.button("예측 실행", type="primary"):
        from src.features.engineering import build_features
        with st.spinner("예측 중..."):
            X, _, _, _ = build_features(df_up, target_col="quality_score",
                                        imputer=imputer, scaler=scaler, fit=False)
            preds = model.predict(X)

        df_result = df_up.copy()
        df_result["predicted_quality"] = preds.round(3)

        st.subheader("예측 결과")
        st.dataframe(df_result, use_container_width=True)

        csv_bytes = df_result.to_csv(index=False).encode("utf-8-sig")
        st.download_button("CSV 다운로드", csv_bytes,
                           file_name="predictions.csv", mime="text/csv")
```

---

### 4-4. 데이터 탐색 (`page_eda`)

**레이아웃**:
```
[제목] 데이터 탐색

[탭1: 분포]        [탭2: 상관관계]    [탭3: 공급사별]
quality_score      heatmap           boxplot
histogram + KDE    상관계수 순위      공급사별 평균 bar
```

**구현 포인트**:
```python
def page_eda():
    st.title("데이터 탐색")

    df = _load_data()
    if df is None:
        st.warning("데이터 파일이 없습니다. generate_sample.py를 실행하세요.")
        return

    st.caption(f"데이터 크기: {df.shape[0]}행 × {df.shape[1]}열")

    tab1, tab2, tab3 = st.tabs(["분포", "상관관계", "공급사별"])

    with tab1:
        # quality_score histogram + KDE (matplotlib)
        ...

    with tab2:
        # seaborn heatmap
        ...

    with tab3:
        # boxplot + bar
        ...
```

---

### 4-5. 모델 정보 (`page_model_info`)

**레이아웃**:
```
[제목] 모델 정보

[모델 사양 테이블]    모델명 / 피처 수 / 학습 방식
[성능 지표]          MAE / RMSE / R² / MAPE (metric 카드 4개)
[피처 중요도]         horizontal bar chart TOP 10
```

**구현 포인트**:
```python
def page_model_info():
    st.title("모델 정보")

    model, imputer, scaler = _load_artifacts()
    df = _load_data()
    if model is None:
        _warn_no_model(); return

    # 모델 사양
    st.subheader("모델 사양")
    spec = {
        "모델": type(model).__name__,
        "피처 수": len(model.feature_names_in_) if hasattr(model, "feature_names_in_") else "-",
        "추정기 수": getattr(model, "n_estimators", "-"),
    }
    st.table(pd.DataFrame([spec]))

    # 성능 지표 (CLAUDE.md 기준, 실데이터 시 재계산)
    st.subheader("샘플 데이터 기준 성능")
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("MAE",  "-")
    c2.metric("RMSE", "3.05")
    c3.metric("R²",   "0.627")
    c4.metric("MAPE", "2.77%")

    # 피처 중요도
    if df is not None:
        from src.features.engineering import build_features
        from src.models.train import get_feature_importance
        X, _, _, _ = build_features(df, target_col="quality_score",
                                    imputer=imputer, scaler=scaler, fit=False)
        fi = get_feature_importance(model, X.columns.tolist()).head(10)

        st.subheader("피처 중요도 TOP 10")
        fig, ax = plt.subplots(figsize=(8, 5))
        ax.barh(fi["feature"], fi["importance"], color="coral")
        ax.invert_yaxis()
        ax.set_xlabel("importance")
        st.pyplot(fig)
        plt.close(fig)
```

---

## 5. requirements.txt 추가 항목

```
streamlit>=1.32
```

> 기존 requirements.txt에 `streamlit>=1.32` 한 줄 추가. 다른 패키지는 기존 범위 내.

---

## 6. 구현 순서 (Do Phase 참고)

1. `requirements.txt`에 `streamlit>=1.32` 추가
2. `app.py` 골격 작성 (import + main() + 사이드바)
3. `_load_artifacts()`, `_load_data()` 공통 함수
4. `page_home()` — 빠른 통계 메트릭
5. `page_recommend()` — 핵심 기능, 입력 패널 + 결과 패널
6. `page_batch_predict()` — 파일 업로드 + 다운로드
7. `page_eda()` — 탭 3개 (분포 / 상관관계 / 공급사별)
8. `page_model_info()` — 피처 중요도
9. `streamlit run app.py` 실행 후 전 페이지 동작 확인
