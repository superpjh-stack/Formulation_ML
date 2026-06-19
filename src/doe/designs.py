"""
src/doe/designs.py
------------------
DOE 설계 행렬 생성 모듈 (numpy 순수 구현, pyDOE2 불필요)

지원 방법:
  1. full_factorial         — 완전요인설계 (2-level 또는 다수준)
  2. fractional_factorial   — 부분요인설계 2^(k-p)
  3. central_composite_design (CCD) — 중심합성설계
  4. box_behnken_design     — 박스-벤켄 설계
  5. taguchi_design         — 다구치 직교배열표 (L4/L8/L9/L16/L18)
  6. latin_hypercube        — 라틴 하이퍼큐브 샘플링 (LHS)

모든 함수 공통 반환값:
  pd.DataFrame
    - 컬럼: 인자명 (실제 값)
    - 컬럼: 인자명 + '_coded' (정규화 값, [-1, +1] 또는 [0, 1])
    - df.attrs['design_type'] 속성으로 설계 유형 식별
"""

from __future__ import annotations

import itertools
import math
from typing import Dict, Any, Literal, Optional

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# 내부 유틸리티
# ---------------------------------------------------------------------------

FactorSpec = Dict[str, Dict[str, Any]]
# 예: {"sn_pct": {"min": 58, "max": 68, "levels": 2}, ...}


def _decode(coded_val: float, lo: float, hi: float) -> float:
    """coded [-1, +1] → 실제 값 [lo, hi]"""
    return lo + (coded_val + 1.0) / 2.0 * (hi - lo)


def _decode_unit(unit_val: float, lo: float, hi: float) -> float:
    """unit [0, 1] → 실제 값 [lo, hi]"""
    return lo + unit_val * (hi - lo)


def _encode(real_val: float, lo: float, hi: float) -> float:
    """실제 값 → coded [-1, +1]"""
    return 2.0 * (real_val - lo) / (hi - lo) - 1.0


def _build_df(
    coded_matrix: np.ndarray,
    factor_names: list[str],
    factors: FactorSpec,
    design_type: str,
    center_coded: float = 0.0,
) -> pd.DataFrame:
    """
    coded 행렬 → 실제값 + coded 컬럼이 모두 포함된 DataFrame 생성.

    coded_matrix shape: (n_runs, k)
    coded 값은 [-1, 0, +1] 또는 확장축점 등 임의의 실수.
    """
    k = len(factor_names)
    assert coded_matrix.shape[1] == k, "컬럼 수 불일치"

    data = {}
    for j, name in enumerate(factor_names):
        lo = factors[name]["min"]
        hi = factors[name]["max"]
        coded_col = coded_matrix[:, j]
        real_col = lo + (coded_col - (-1.0)) / 2.0 * (hi - lo)
        data[name] = real_col
        data[f"{name}_coded"] = coded_col

    df = pd.DataFrame(data)
    df.index = pd.RangeIndex(1, len(df) + 1, name="run")
    df.attrs["design_type"] = design_type
    return df


# ---------------------------------------------------------------------------
# 1. 완전요인설계 (Full Factorial)
# ---------------------------------------------------------------------------

def full_factorial(
    factors: FactorSpec,
    coded: bool = False,
) -> pd.DataFrame:
    """
    완전요인설계 행렬 생성.

    Parameters
    ----------
    factors : dict
        {"factor_name": {"min": float, "max": float, "levels": int}, ...}
        levels 기본값 2 (2-level full factorial).
    coded : bool
        True이면 min/max 대신 -1/+1 기준으로만 반환 (실제값 컬럼 동일).

    Returns
    -------
    pd.DataFrame
        완전요인 실험 계획 (실제값 + _coded 컬럼).
    """
    factor_names = list(factors.keys())
    level_lists = []
    for name in factor_names:
        spec = factors[name]
        n_levels = int(spec.get("levels", 2))
        lo, hi = float(spec["min"]), float(spec["max"])
        if n_levels == 2:
            level_lists.append([-1.0, 1.0])
        else:
            # n_levels > 2: 균등 분할
            level_lists.append(list(np.linspace(-1.0, 1.0, n_levels)))

    # 카르테시안 곱
    runs = list(itertools.product(*level_lists))
    coded_matrix = np.array(runs, dtype=float)

    return _build_df(coded_matrix, factor_names, factors, "full_factorial")


# ---------------------------------------------------------------------------
# 2. 부분요인설계 (Fractional Factorial)
# ---------------------------------------------------------------------------

# 표준 발생자(generator) 정의 — 2^(k-p) 설계
# key: (k, p) — 인자 수, confounding 수
# value: (base_cols, generators)
#   base_cols: 기본 인자 인덱스 (0-based)
#   generators: [(new_col_idx, interaction_indices), ...]
_FF_GENERATORS: dict[tuple[int, int], tuple[list[int], list[tuple[int, ...]]]] = {
    # 2^(3-1) Resolution III: D = AB
    (3, 1): ([0, 1], [(2, (0, 1))]),
    # 2^(4-1) Resolution IV: D = ABC
    (4, 1): ([0, 1, 2], [(3, (0, 1, 2))]),
    # 2^(4-2) Resolution III: C=AB, D=AC
    (4, 2): ([0, 1], [(2, (0, 1)), (3, (0, 2))]),
    # 2^(5-1) Resolution V: E = ABCD
    (5, 1): ([0, 1, 2, 3], [(4, (0, 1, 2, 3))]),
    # 2^(5-2) Resolution III: D=AB, E=AC
    (5, 2): ([0, 1, 2], [(3, (0, 1)), (4, (0, 2))]),
    # 2^(6-1) Resolution VI: F = ABCDE
    (6, 1): ([0, 1, 2, 3, 4], [(5, (0, 1, 2, 3, 4))]),
    # 2^(6-2) Resolution IV: E=ABC, F=BCD
    (6, 2): ([0, 1, 2, 3], [(4, (0, 1, 2)), (5, (1, 2, 3))]),
    # 2^(7-1) Resolution VII: G = ABCDEF
    (7, 1): ([0, 1, 2, 3, 4, 5], [(6, (0, 1, 2, 3, 4, 5))]),
    # 2^(7-2) Resolution IV: F=ABC, G=ABD
    (7, 2): ([0, 1, 2, 3, 4], [(5, (0, 1, 2)), (6, (0, 1, 3))]),
    # 2^(7-3) Resolution IV: E=ABC, F=ABD, G=ACD
    (7, 3): ([0, 1, 2, 3], [(4, (0, 1, 2)), (5, (0, 1, 3)), (6, (0, 2, 3))]),
    # 2^(8-2) Resolution V: G=ABCD, H=ABEF
    (8, 2): ([0, 1, 2, 3, 4, 5], [(6, (0, 1, 2, 3)), (7, (0, 1, 4, 5))]),
    # 2^(8-4) Resolution IV
    (8, 4): ([0, 1, 2, 3], [(4, (0, 1, 2)), (5, (0, 1, 3)), (6, (0, 2, 3)), (7, (1, 2, 3))]),
}


def fractional_factorial(
    factors: FactorSpec,
    resolution: int = 4,
) -> pd.DataFrame:
    """
    2^(k-p) 부분요인설계 행렬 생성.

    Parameters
    ----------
    factors : dict
        {"factor_name": {"min": float, "max": float}, ...}  (levels=2 고정)
    resolution : int
        목표 Resolution. 달성 가능한 최대 resolution의 설계를 선택.
        가능한 조합이 없으면 full factorial 반환.

    Returns
    -------
    pd.DataFrame
    """
    factor_names = list(factors.keys())
    k = len(factor_names)

    # k <= 2이면 완전요인으로 처리
    if k <= 2:
        return full_factorial(factors)

    # 적합한 (k, p) 탐색 — 최소 실험 수이면서 resolution 만족
    best_key = None
    for p in range(1, k):
        key = (k, p)
        if key in _FF_GENERATORS:
            # 실제 resolution 계산은 복잡하므로 p=1은 높은 resolution, 큰 p일수록 낮음
            # 간단히 p가 작을수록 우선 (resolution 높음)
            if best_key is None:
                best_key = key
            break  # 최소 p (최고 resolution) 선택

    if best_key is None:
        # 발생자 없으면 full factorial
        return full_factorial(factors)

    base_cols, generators = _FF_GENERATORS[best_key]
    n_base = len(base_cols)
    # 기본 인자 2^n_base full factorial
    base_runs = list(itertools.product([-1.0, 1.0], repeat=n_base))
    n_runs = len(base_runs)
    coded_matrix = np.ones((n_runs, k), dtype=float)

    # 기본 인자 채우기
    for j, col_idx in enumerate(base_cols):
        coded_matrix[:, col_idx] = [row[j] for row in base_runs]

    # 발생자 인자 채우기
    for new_col_idx, interaction_idx in generators:
        col = np.ones(n_runs, dtype=float)
        for idx in interaction_idx:
            col = col * coded_matrix[:, idx]
        coded_matrix[:, new_col_idx] = col

    return _build_df(coded_matrix, factor_names, factors, "fractional_factorial")


# ---------------------------------------------------------------------------
# 3. 중심합성설계 (Central Composite Design, CCD)
# ---------------------------------------------------------------------------

def central_composite_design(
    factors: FactorSpec,
    alpha: Literal["rotatable", "orthogonal", "face"] = "rotatable",
    center_points: int = 4,
) -> pd.DataFrame:
    """
    중심합성설계(CCD) 행렬 생성.

    Parameters
    ----------
    factors : dict
        {"factor_name": {"min": float, "max": float}, ...}
    alpha : str
        'rotatable' — alpha = (2^k)^0.25 (회전성)
        'orthogonal' — alpha = (n_total * n_axial / (8 * center_points))^0.25
        'face'      — alpha = 1 (Face-Centered CCD)
    center_points : int
        중심점 반복 수 (기본 4).

    Returns
    -------
    pd.DataFrame
        factorial points + axial points + center points.
    """
    factor_names = list(factors.keys())
    k = len(factor_names)

    # 인자점(factorial part): 2^k full factorial -1/+1
    factorial_runs = np.array(list(itertools.product([-1.0, 1.0], repeat=k)), dtype=float)
    n_factorial = len(factorial_runs)

    # alpha 결정
    if alpha == "rotatable":
        alpha_val = float(n_factorial ** 0.25)
    elif alpha == "orthogonal":
        n_axial = 2 * k
        n_total_est = n_factorial + n_axial + center_points
        alpha_val = ((n_total_est * n_axial) / (8 * center_points)) ** 0.25
    elif alpha == "face":
        alpha_val = 1.0
    else:
        raise ValueError(f"alpha must be 'rotatable', 'orthogonal', or 'face', got '{alpha}'")

    # 축점(axial / star points): ±alpha on each axis
    axial_runs = np.zeros((2 * k, k), dtype=float)
    for i in range(k):
        axial_runs[2 * i, i] = alpha_val
        axial_runs[2 * i + 1, i] = -alpha_val

    # 중심점
    center_runs = np.zeros((center_points, k), dtype=float)

    coded_matrix = np.vstack([factorial_runs, axial_runs, center_runs])

    df = _build_df(coded_matrix, factor_names, factors, "ccd")
    df.attrs["alpha"] = alpha_val
    df.attrs["alpha_type"] = alpha
    return df


# ---------------------------------------------------------------------------
# 4. 박스-벤켄 설계 (Box-Behnken Design)
# ---------------------------------------------------------------------------

# 표준 박스-벤켄 블록 정의 (k=3 ~ 7)
# 각 항목: 한 쌍의 인자 인덱스 + 나머지 인자는 0
_BBD_BLOCKS: dict[int, list[list[int]]] = {
    3: [[0, 1], [0, 2], [1, 2]],
    4: [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]],
    5: [[0, 1], [0, 2], [0, 3], [0, 4],
        [1, 2], [1, 3], [1, 4],
        [2, 3], [2, 4], [3, 4]],
    6: [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5],
        [1, 2], [1, 3], [1, 4], [1, 5],
        [2, 3], [2, 4], [2, 5],
        [3, 4], [3, 5], [4, 5]],
    7: [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6],
        [1, 2], [1, 3], [1, 4], [1, 5], [1, 6],
        [2, 3], [2, 4], [2, 5], [2, 6],
        [3, 4], [3, 5], [3, 6],
        [4, 5], [4, 6], [5, 6]],
}


def box_behnken_design(
    factors: FactorSpec,
    center_points: int = 3,
) -> pd.DataFrame:
    """
    박스-벤켄 설계 행렬 생성.

    Parameters
    ----------
    factors : dict
        {"factor_name": {"min": float, "max": float}, ...}
        인자 수 k: 3 ~ 7 지원 (k<3이면 CCD로 자동 전환).
    center_points : int
        중심점 반복 수 (기본 3).

    Returns
    -------
    pd.DataFrame
    """
    factor_names = list(factors.keys())
    k = len(factor_names)

    if k < 3:
        # k < 3은 BBD 불가 — CCD로 대체
        return central_composite_design(factors)
    if k > 7:
        raise ValueError(f"박스-벤켄 설계는 k=3~7만 지원합니다 (현재 k={k}).")

    blocks = _BBD_BLOCKS[k]
    corner_combos = list(itertools.product([-1.0, 1.0], repeat=2))  # 4개

    rows = []
    for pair in blocks:
        for combo in corner_combos:
            row = np.zeros(k)
            row[pair[0]] = combo[0]
            row[pair[1]] = combo[1]
            rows.append(row)

    # 중심점
    for _ in range(center_points):
        rows.append(np.zeros(k))

    coded_matrix = np.array(rows, dtype=float)
    return _build_df(coded_matrix, factor_names, factors, "box_behnken")


# ---------------------------------------------------------------------------
# 5. 다구치 직교배열표 (Taguchi Orthogonal Arrays)
# ---------------------------------------------------------------------------

# 각 직교배열표를 -1/0/+1 코딩으로 정의
# 원본 1/2 → -1/+1, 원본 1/2/3 → -1/0/+1
def _taguchi_to_coded(array: np.ndarray) -> np.ndarray:
    """Taguchi 1-indexed array → -1/0/+1 coded"""
    unique_vals = np.unique(array)
    n = len(unique_vals)
    mapping = {v: -1.0 + 2.0 * i / (n - 1) for i, v in enumerate(sorted(unique_vals))}
    coded = np.vectorize(mapping.get)(array).astype(float)
    return coded


# L4: 3 factors, 4 runs (2-level)
_L4 = np.array([
    [1, 1, 1],
    [1, 2, 2],
    [2, 1, 2],
    [2, 2, 1],
], dtype=int)

# L8: 7 factors, 8 runs (2-level)
_L8 = np.array([
    [1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 2, 2, 2, 2],
    [1, 2, 2, 1, 1, 2, 2],
    [1, 2, 2, 2, 2, 1, 1],
    [2, 1, 2, 1, 2, 1, 2],
    [2, 1, 2, 2, 1, 2, 1],
    [2, 2, 1, 1, 2, 2, 1],
    [2, 2, 1, 2, 1, 1, 2],
], dtype=int)

# L9: 4 factors, 9 runs (3-level)
_L9 = np.array([
    [1, 1, 1, 1],
    [1, 2, 2, 2],
    [1, 3, 3, 3],
    [2, 1, 2, 3],
    [2, 2, 3, 1],
    [2, 3, 1, 2],
    [3, 1, 3, 2],
    [3, 2, 1, 3],
    [3, 3, 2, 1],
], dtype=int)

# L16: 15 factors, 16 runs (2-level)
_L16 = np.array([
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,2,2,2,2,2,2,2,2],
    [1,1,1,2,2,2,2,1,1,1,1,2,2,2,2],
    [1,1,1,2,2,2,2,2,2,2,2,1,1,1,1],
    [1,2,2,1,1,2,2,1,1,2,2,1,1,2,2],
    [1,2,2,1,1,2,2,2,2,1,1,2,2,1,1],
    [1,2,2,2,2,1,1,1,1,2,2,2,2,1,1],
    [1,2,2,2,2,1,1,2,2,1,1,1,1,2,2],
    [2,1,2,1,2,1,2,1,2,1,2,1,2,1,2],
    [2,1,2,1,2,1,2,2,1,2,1,2,1,2,1],
    [2,1,2,2,1,2,1,1,2,1,2,2,1,2,1],
    [2,1,2,2,1,2,1,2,1,2,1,1,2,1,2],
    [2,2,1,1,2,2,1,1,2,2,1,1,2,2,1],
    [2,2,1,1,2,2,1,2,1,1,2,2,1,1,2],
    [2,2,1,2,1,1,2,1,2,2,1,2,1,1,2],
    [2,2,1,2,1,1,2,2,1,1,2,1,2,2,1],
], dtype=int)

# L18: 8 factors (1개 2-level + 7개 3-level), 18 runs
_L18 = np.array([
    [1,1,1,1,1,1,1,1],
    [1,1,2,2,2,2,2,2],
    [1,1,3,3,3,3,3,3],
    [1,2,1,1,2,2,3,3],
    [1,2,2,2,3,3,1,1],
    [1,2,3,3,1,1,2,2],
    [1,3,1,2,1,3,2,3],
    [1,3,2,3,2,1,3,1],
    [1,3,3,1,3,2,1,2],
    [2,1,1,3,3,2,2,1],
    [2,1,2,1,1,3,3,2],
    [2,1,3,2,2,1,1,3],
    [2,2,1,2,3,1,3,2],
    [2,2,2,3,1,2,1,3],
    [2,2,3,1,2,3,2,1],
    [2,3,1,3,2,3,1,2],
    [2,3,2,1,3,1,2,3],
    [2,3,3,2,1,2,3,1],
], dtype=int)

_TAGUCHI_ARRAYS: dict[str, np.ndarray] = {
    "L4":  _L4,
    "L8":  _L8,
    "L9":  _L9,
    "L16": _L16,
    "L18": _L18,
}

_TAGUCHI_MAX_FACTORS: dict[str, int] = {
    "L4": 3, "L8": 7, "L9": 4, "L16": 15, "L18": 8,
}


def taguchi_design(
    factors: FactorSpec,
    array_type: Literal["L4", "L8", "L9", "L16", "L18", "auto"] = "L8",
) -> pd.DataFrame:
    """
    다구치 직교배열표 기반 설계 행렬 생성.

    Parameters
    ----------
    factors : dict
        {"factor_name": {"min": float, "max": float}, ...}
    array_type : str
        'L4', 'L8', 'L9', 'L16', 'L18', 또는 'auto'
        'auto' — 인자 수에 맞는 최소 직교배열 자동 선택.

    Returns
    -------
    pd.DataFrame
    """
    factor_names = list(factors.keys())
    k = len(factor_names)

    if array_type == "auto":
        # 인자 수를 수용하는 가장 작은 직교배열 선택
        candidates = [(name, max_k) for name, max_k in _TAGUCHI_MAX_FACTORS.items()
                      if max_k >= k]
        if not candidates:
            raise ValueError(
                f"인자 수 k={k}를 수용하는 다구치 직교배열이 없습니다 (최대 L16=15개)."
            )
        array_type = min(candidates, key=lambda x: x[1])[0]

    if array_type not in _TAGUCHI_ARRAYS:
        raise ValueError(f"지원하지 않는 array_type: '{array_type}'. "
                         f"선택 가능: {list(_TAGUCHI_ARRAYS.keys())} 또는 'auto'")

    raw_array = _TAGUCHI_ARRAYS[array_type]
    max_k = _TAGUCHI_MAX_FACTORS[array_type]

    if k > max_k:
        raise ValueError(
            f"{array_type}은 최대 {max_k}개 인자를 지원합니다 (요청: {k}개)."
        )

    # 필요한 컬럼만 사용 (앞 k개)
    raw_subset = raw_array[:, :k]
    coded_matrix = _taguchi_to_coded(raw_subset)

    df = _build_df(coded_matrix, factor_names, factors, "taguchi")
    df.attrs["array_type"] = array_type
    return df


# ---------------------------------------------------------------------------
# 6. 라틴 하이퍼큐브 샘플링 (Latin Hypercube Sampling)
# ---------------------------------------------------------------------------

def latin_hypercube(
    factors: FactorSpec,
    n_samples: int = 30,
    seed: Optional[int] = 42,
    criterion: Literal["center", "random", "maximin"] = "center",
) -> pd.DataFrame:
    """
    라틴 하이퍼큐브 샘플링 (LHS).

    Parameters
    ----------
    factors : dict
        {"factor_name": {"min": float, "max": float}, ...}
    n_samples : int
        샘플 수 (기본 30).
    seed : int or None
        난수 시드.
    criterion : str
        'center'   — 각 층 중앙값 사용
        'random'   — 각 층 내 균일 랜덤
        'maximin'  — maximin 기준으로 후보군 중 최선 선택 (근사)

    Returns
    -------
    pd.DataFrame
        unit [0, 1] 공간에서 샘플링 후 실제값으로 변환.
    """
    rng = np.random.default_rng(seed)
    factor_names = list(factors.keys())
    k = len(factor_names)

    if criterion == "center":
        # 각 층의 중앙점 사용 → 결정론적 (층 순서만 섞음)
        unit_matrix = np.zeros((n_samples, k))
        for j in range(k):
            perm = rng.permutation(n_samples)
            unit_matrix[:, j] = (perm + 0.5) / n_samples

    elif criterion == "random":
        unit_matrix = np.zeros((n_samples, k))
        for j in range(k):
            perm = rng.permutation(n_samples)
            unit_offsets = rng.uniform(0, 1, n_samples)
            unit_matrix[:, j] = (perm + unit_offsets) / n_samples

    elif criterion == "maximin":
        # 후보군 5개 중 최소 거리가 최대인 설계 선택
        best_design = None
        best_min_dist = -np.inf
        for _ in range(5):
            candidate = np.zeros((n_samples, k))
            for j in range(k):
                perm = rng.permutation(n_samples)
                unit_offsets = rng.uniform(0, 1, n_samples)
                candidate[:, j] = (perm + unit_offsets) / n_samples
            # 최소 거리 계산
            min_dist = np.inf
            for i in range(n_samples):
                for jj in range(i + 1, n_samples):
                    d = np.linalg.norm(candidate[i] - candidate[jj])
                    if d < min_dist:
                        min_dist = d
            if min_dist > best_min_dist:
                best_min_dist = min_dist
                best_design = candidate
        unit_matrix = best_design

    else:
        raise ValueError(f"criterion must be 'center', 'random', or 'maximin', got '{criterion}'")

    # unit [0,1] → coded [-1, +1]
    coded_matrix = 2.0 * unit_matrix - 1.0

    df = _build_df(coded_matrix, factor_names, factors, "lhs")
    df.attrs["n_samples"] = n_samples
    df.attrs["criterion"] = criterion
    return df


# ---------------------------------------------------------------------------
# 편의 함수: 메서드 이름 → 함수 매핑
# ---------------------------------------------------------------------------

DESIGN_REGISTRY: dict[str, Any] = {
    "full_factorial": full_factorial,
    "fractional_factorial": fractional_factorial,
    "ccd": central_composite_design,
    "box_behnken": box_behnken_design,
    "taguchi": taguchi_design,
    "lhs": latin_hypercube,
}


def get_design(
    method: str,
    factors: FactorSpec,
    **kwargs: Any,
) -> pd.DataFrame:
    """
    설계 방법 이름으로 설계 행렬 생성.

    Parameters
    ----------
    method : str
        'full_factorial' | 'fractional_factorial' | 'ccd' |
        'box_behnken' | 'taguchi' | 'lhs'
    factors : dict
    **kwargs
        각 설계 함수에 전달할 추가 파라미터.

    Returns
    -------
    pd.DataFrame
    """
    if method not in DESIGN_REGISTRY:
        raise ValueError(
            f"알 수 없는 설계 방법: '{method}'. "
            f"지원 목록: {list(DESIGN_REGISTRY.keys())}"
        )
    return DESIGN_REGISTRY[method](factors, **kwargs)


# ---------------------------------------------------------------------------
# 메타데이터
# ---------------------------------------------------------------------------

DOE_METHOD_METADATA: dict[str, dict[str, Any]] = {
    "full_factorial": {
        "name_ko": "완전요인설계",
        "description": "모든 인자 조합을 망라. 2^k 실험 수.",
        "min_factors": 1,
        "max_factors": 8,
        "strengths": ["주효과 및 모든 교호작용 추정 가능", "해석 단순"],
        "weaknesses": ["인자 증가 시 실험 수 급증"],
        "typical_use": "인자 수 ≤ 5, 예산 충분",
    },
    "fractional_factorial": {
        "name_ko": "부분요인설계",
        "description": "2^(k-p) 설계. 주효과 위주 스크리닝.",
        "min_factors": 3,
        "max_factors": 8,
        "strengths": ["실험 수 절감", "스크리닝에 적합"],
        "weaknesses": ["일부 교호작용 혼동(confounding)"],
        "typical_use": "인자 수 ≥ 4, 중요 인자 선별 단계",
    },
    "ccd": {
        "name_ko": "중심합성설계 (CCD)",
        "description": "이차 반응표면 모델 적합. 회전성/직교성 옵션.",
        "min_factors": 2,
        "max_factors": 6,
        "strengths": ["2차 모델 추정", "회전성으로 균일한 예측 분산"],
        "weaknesses": ["실험 수 많음 (인자 증가 시)"],
        "typical_use": "최적점 탐색, RSM 분석",
    },
    "box_behnken": {
        "name_ko": "박스-벤켄 설계",
        "description": "꼭짓점 없음. CCD 대비 극단값 실험 회피.",
        "min_factors": 3,
        "max_factors": 7,
        "strengths": ["극단값 실험 없음 (안전성)", "2차 모델 추정"],
        "weaknesses": ["k=3 최소 요건"],
        "typical_use": "공정 안전 제약이 있는 최적화",
    },
    "taguchi": {
        "name_ko": "다구치 직교배열표",
        "description": "L4/L8/L9/L16/L18 직교배열. 강건설계.",
        "min_factors": 2,
        "max_factors": 15,
        "strengths": ["실험 수 최소화", "강건 설계(robustness)"],
        "weaknesses": ["교호작용 추정 제한"],
        "typical_use": "대량 스크리닝, 강건 최적화",
    },
    "lhs": {
        "name_ko": "라틴 하이퍼큐브 샘플링 (LHS)",
        "description": "계층화 랜덤 샘플링. 공간 균일 탐색.",
        "min_factors": 1,
        "max_factors": 50,
        "strengths": ["연속 공간 균일 탐색", "인자 수 무제한"],
        "weaknesses": ["직교성 보장 없음"],
        "typical_use": "머신러닝 학습 데이터 생성, 대규모 탐색",
    },
}
