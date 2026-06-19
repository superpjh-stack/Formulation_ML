import pandas as pd
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent.parent / "data"


def load_raw(filename: str) -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / "raw" / filename)


def load_processed(filename: str) -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / "processed" / filename)


def save_processed(df: pd.DataFrame, filename: str) -> None:
    path = DATA_DIR / "processed" / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False)
