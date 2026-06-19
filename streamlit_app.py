import sys
from pathlib import Path

import joblib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
import streamlit as st

sys.path.insert(0, str(Path(__file__).parent))

# ──────────────────────────────────────────────
# 공통 유틸
# ──────────────────────────────────────────────

@st.cache_resource
def _load_artifacts(model_name: str = "gradient_boosting"):
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


def _get_suppliers(df) -> list:
    if df is not None and "supplier_id" in df.columns:
        return sorted(df["supplier_id"].unique().tolist())
    return ["SUP_A", "SUP_B", "SUP_C"]


def _warn_no_model():
    st.warning(
        "모델 파일이 없습니다. 먼저 학습을 실행하세요:\n\n"
        "```bash\n"
        "python scripts/train.py --data formulation_history.csv \\\n"
        "                        --target quality_score \\\n"
        "                        --model gradient_boosting\n"
        "```"
    )


# ──────────────────────────────────────────────
# 페이지: 홈
# ──────────────────────────────────────────────

def page_home():
    st.title("배합비율 최적화 ML 시스템")
    st.markdown(
        "성분분석 데이터 기반 **최적 배합비율 자동 추천** 및 **품질 예측** 시스템입니다.  \n"
        "왼쪽 사이드바에서 원하는 기능을 선택하세요."
    )
    st.divider()

    df = _load_data()
    model, _, _ = _load_artifacts()

    col1, col2, col3, col4 = st.columns(4)
    col1.metric("데이터 건수",  f"{len(df):,}건"                      if df is not None    else "-")
    col2.metric("불량률",        f"{df['is_defect'].mean()*100:.1f}%"  if df is not None    else "-")
    col3.metric("모델 MAPE",     "2.77%"                               if model is not None else "-")
    col4.metric("모델 R²",       "0.627"                               if model is not None else "-")

    st.divider()
    st.subheader("기능 안내")
    st.markdown(
        "| 페이지 | 설명 |\n"
        "|--------|------|\n"
        "| 배합 추천 | 공정 조건 입력 → 최적 배합비율 + 예측 품질점수 |\n"
        "| 배치 예측 | CSV 업로드 → quality_score 예측 결과 다운로드 |\n"
        "| 데이터 탐색 | 분포 / 상관관계 / 공급사별 품질 시각화 |\n"
        "| 모델 정보 | 피처 중요도 TOP 10 + 성능 지표 |\n"
    )

    if df is None:
        st.info("데이터가 없습니다. `python data/raw/generate_sample.py`를 먼저 실행하세요.")
    if model is None:
        _warn_no_model()


# ──────────────────────────────────────────────
# 페이지: 배합 추천
# ──────────────────────────────────────────────

def page_recommend():
    st.title("신규 LOT 배합비율 추천")
    st.markdown("공정 조건을 입력하면 최적 배합비율과 예측 품질점수를 반환합니다.")

    df = _load_data()
    model, imputer, scaler = _load_artifacts()
    if model is None:
        _warn_no_model()
        return

    col_in, col_out = st.columns([1, 1])

    with col_in:
        st.subheader("공정 조건 입력")
        temp      = st.slider("용해 온도 (°C)",  min_value=200, max_value=300, value=250, step=5)
        time_min  = st.slider("가열 시간 (분)",  min_value=20,  max_value=90,  value=45,  step=1)
        suppliers = _get_suppliers(df)
        supplier  = st.selectbox("공급사", suppliers)
        run_btn   = st.button("최적 배합비율 추천", type="primary", use_container_width=True)

    with col_out:
        st.subheader("추천 결과")
        if run_btn:
            from src.models.optimize import recommend_ratios

            process_cond = {"melt_temp_c": float(temp), "melt_time_min": float(time_min)}
            for s in suppliers[1:]:
                process_cond[f"supplier_id_{s}"] = 1.0 if supplier == s else 0.0

            with st.spinner("최적화 중..."):
                result = recommend_ratios(process_cond, model, imputer, scaler)

            if result["success"]:
                ratio_keys = ["sn_pct", "ag_pct", "cu_pct", "pb_pct"]
                ratios = {k: result[k] for k in ratio_keys}

                fig, ax = plt.subplots(figsize=(6, 3))
                ax.bar(ratios.keys(), ratios.values(), color="steelblue", edgecolor="white")
                ax.set_ylabel("%")
                ax.set_title("최적 배합비율")
                ax.set_ylim(0, 100)
                for bar, val in zip(ax.patches, ratios.values()):
                    ax.text(bar.get_x() + bar.get_width() / 2,
                            bar.get_height() + 0.5,
                            f"{val:.1f}%", ha="center", va="bottom", fontsize=9)
                st.pyplot(fig)
                plt.close(fig)

                st.dataframe(
                    pd.DataFrame({"성분": list(ratios.keys()),
                                  "비율 (%)": list(ratios.values())}),
                    use_container_width=True, hide_index=True
                )
                st.metric("예측 품질점수", f"{result['predicted_quality']:.2f}")
            else:
                st.warning(result["message"])
                st.info("표준 배합비율이 반환됩니다.")
        else:
            st.info("왼쪽에서 공정 조건을 입력하고 버튼을 누르세요.")


# ──────────────────────────────────────────────
# 페이지: 배치 예측
# ──────────────────────────────────────────────

def page_batch_predict():
    st.title("배치 예측")
    st.markdown("CSV 파일을 업로드하면 각 행의 `quality_score`를 예측합니다.")

    model, imputer, scaler = _load_artifacts()
    if model is None:
        _warn_no_model()
        return

    st.info(
        "필수 컬럼: `sn_pct`, `ag_pct`, `cu_pct`, `pb_pct`, "
        "`melt_temp_c`, `melt_time_min`, `supplier_id`"
    )
    uploaded = st.file_uploader("CSV 파일 업로드", type=["csv"])
    if uploaded is None:
        return

    df_up = pd.read_csv(uploaded)
    st.subheader("업로드 데이터 미리보기")
    st.dataframe(df_up.head(), use_container_width=True)
    st.caption(f"총 {len(df_up):,}행")

    if st.button("예측 실행", type="primary"):
        from src.features.engineering import build_features
        with st.spinner("예측 중..."):
            X, _, _, _ = build_features(
                df_up, target_col="quality_score",
                imputer=imputer, scaler=scaler, fit=False
            )
            preds = model.predict(X)

        df_result = df_up.copy()
        df_result["predicted_quality"] = np.round(preds, 3)

        st.subheader("예측 결과")
        st.dataframe(df_result, use_container_width=True)

        csv_bytes = df_result.to_csv(index=False).encode("utf-8-sig")
        st.download_button(
            "CSV 다운로드", csv_bytes,
            file_name="predictions.csv", mime="text/csv",
            use_container_width=True
        )


# ──────────────────────────────────────────────
# 페이지: 데이터 탐색
# ──────────────────────────────────────────────

def page_eda():
    st.title("데이터 탐색")

    df = _load_data()
    if df is None:
        st.warning("데이터 파일이 없습니다. `python data/raw/generate_sample.py`를 먼저 실행하세요.")
        return

    st.caption(f"데이터 크기: {df.shape[0]:,}행 × {df.shape[1]}열")

    tab1, tab2, tab3 = st.tabs(["분포", "상관관계", "공급사별"])

    numeric_cols = ["sn_pct", "ag_pct", "cu_pct", "pb_pct",
                    "melt_temp_c", "melt_time_min", "quality_score"]

    with tab1:
        st.subheader("quality_score 분포")
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4))
        df["quality_score"].plot.hist(bins=30, ax=ax1, alpha=0.7,
                                      color="steelblue", edgecolor="white")
        ax1.axvline(df["quality_score"].mean(), color="red", linestyle="--",
                    label=f"mean={df['quality_score'].mean():.1f}")
        ax1.set_title("Histogram")
        ax1.set_xlabel("quality_score")
        ax1.legend()
        df["quality_score"].plot.kde(ax=ax2, color="darkorange")
        ax2.set_title("KDE")
        ax2.set_xlabel("quality_score")
        plt.tight_layout()
        st.pyplot(fig)
        plt.close(fig)

        col_a, col_b, col_c = st.columns(3)
        col_a.metric("평균",    f"{df['quality_score'].mean():.2f}")
        col_b.metric("표준편차", f"{df['quality_score'].std():.2f}")
        col_c.metric("왜도",    f"{df['quality_score'].skew():.3f}")

    with tab2:
        st.subheader("피처 상관관계 히트맵")
        corr = df[numeric_cols].corr()
        fig, ax = plt.subplots(figsize=(9, 7))
        mask = np.triu(np.ones_like(corr, dtype=bool))
        sns.heatmap(corr, annot=True, fmt=".2f", cmap="RdYlGn",
                    center=0, mask=mask, square=True, linewidths=0.5, ax=ax)
        ax.set_title("피처 상관관계 히트맵")
        plt.tight_layout()
        st.pyplot(fig)
        plt.close(fig)

        st.subheader("quality_score 상관계수 순위")
        top = corr["quality_score"].drop("quality_score").abs().sort_values(ascending=False)
        st.dataframe(
            top.reset_index().rename(columns={"index": "피처", "quality_score": "|r|"}),
            use_container_width=True, hide_index=True
        )

    with tab3:
        st.subheader("공급사별 품질 분포")
        fig, axes = plt.subplots(1, 2, figsize=(12, 5))
        df.boxplot(column="quality_score", by="supplier_id", ax=axes[0])
        axes[0].set_title("공급사별 품질점수 분포")
        axes[0].set_xlabel("supplier_id")
        plt.suptitle("")

        df.groupby("supplier_id")["quality_score"].mean().sort_values().plot.bar(
            ax=axes[1], color="steelblue", edgecolor="black")
        axes[1].set_title("공급사별 평균 품질점수")
        axes[1].set_xlabel("supplier_id")
        axes[1].set_ylabel("mean quality_score")
        axes[1].tick_params(axis="x", rotation=0)
        plt.tight_layout()
        st.pyplot(fig)
        plt.close(fig)

        st.dataframe(
            df.groupby("supplier_id")["quality_score"]
              .agg(["mean", "std", "count"]).round(2)
              .rename(columns={"mean": "평균", "std": "표준편차", "count": "건수"}),
            use_container_width=True
        )


# ──────────────────────────────────────────────
# 페이지: 모델 정보
# ──────────────────────────────────────────────

def page_model_info():
    st.title("모델 정보")

    model, imputer, scaler = _load_artifacts()
    df = _load_data()
    if model is None:
        _warn_no_model()
        return

    st.subheader("모델 사양")
    n_features = len(model.feature_names_in_) if hasattr(model, "feature_names_in_") else "-"
    st.table(pd.DataFrame([{
        "모델": type(model).__name__,
        "피처 수": n_features,
        "추정기 수(n_estimators)": getattr(model, "n_estimators", "-"),
    }]))

    st.subheader("성능 지표 (샘플 데이터 기준)")
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("MAE",  "-")
    c2.metric("RMSE", "3.05")
    c3.metric("R²",   "0.627")
    c4.metric("MAPE", "2.77%")
    st.caption("R² < 0.85는 샘플 노이즈(σ=3) 영향. 실데이터 투입 후 재측정 필요.")

    if df is not None:
        from src.features.engineering import build_features
        from src.models.train import get_feature_importance

        st.subheader("피처 중요도 TOP 10")
        X, _, _, _ = build_features(
            df, target_col="quality_score",
            imputer=imputer, scaler=scaler, fit=False
        )
        fi_dict = get_feature_importance(model, X.columns.tolist())
        fi = pd.DataFrame(list(fi_dict.items()), columns=["feature", "importance"])

        fig, ax = plt.subplots(figsize=(8, 5))
        ax.barh(fi["feature"], fi["importance"], color="coral")
        ax.invert_yaxis()
        ax.set_xlabel("importance")
        ax.set_title("피처 중요도 TOP 10 (GradientBoosting)")
        plt.tight_layout()
        st.pyplot(fig)
        plt.close(fig)

        st.dataframe(fi, use_container_width=True, hide_index=True)


# ──────────────────────────────────────────────
# 메인
# ──────────────────────────────────────────────

def main():
    st.set_page_config(
        page_title="배합비율 최적화 ML",
        page_icon="⚗️",
        layout="wide",
    )

    st.sidebar.title("⚗️ 배합비율 최적화 ML")
    st.sidebar.markdown("---")
    page = st.sidebar.radio(
        "페이지 선택",
        ["홈", "배합 추천", "배치 예측", "데이터 탐색", "모델 정보"],
        label_visibility="collapsed",
    )
    st.sidebar.markdown("---")
    st.sidebar.caption("Formulation ML v1.0  \nModel: GradientBoosting")

    {
        "홈":         page_home,
        "배합 추천":   page_recommend,
        "배치 예측":   page_batch_predict,
        "데이터 탐색": page_eda,
        "모델 정보":   page_model_info,
    }[page]()


if __name__ == "__main__":
    main()
