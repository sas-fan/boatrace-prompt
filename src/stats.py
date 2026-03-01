"""
BoatraceCSV の results から選手統計を計算・保存・読み込みする。

統計の内容:
  枠別成績  : 登録番号 × 枠番 → 出走数 / 1着数 / 2着数 / 3着数
  決まり手  : 登録番号 × 決まり手 → 1着数
"""
import io
import datetime
from pathlib import Path

import pandas as pd
import requests

BASE_URL = "https://boatracecsv.github.io/data/results"
STATS_PATH = Path(__file__).parent.parent / "data" / "stats.parquet"
META_PATH = Path(__file__).parent.parent / "data" / "stats_meta.txt"

# BoatraceCSV が公開しているデータの開始年
DATA_START_YEAR = 2022

WINNING_TECHNIQUES = ["逃げ", "差し", "まくり", "まくり差し", "抜き", "恵まれ"]


def _fetch_csv(year: int, month: int, day: int) -> pd.DataFrame | None:
    """1日分の results.csv を取得して DataFrame を返す。失敗時は None。"""
    url = f"{BASE_URL}/{year}/{month:02d}/{day:02d}.csv"
    try:
        resp = requests.get(url, timeout=15)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return pd.read_csv(io.StringIO(resp.text))
    except Exception:
        return None


def _process_df(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    1日分の DataFrame から枠別成績・決まり手集計を生成する。

    Returns
    -------
    (frame_df, wt_df)
      frame_df : 登録番号・枠番・着順の行リスト
      wt_df    : 登録番号・決まり手の行リスト（1着のみ）
    """
    frame_rows = []
    wt_rows = []

    for _, row in df.iterrows():
        winning_technique = str(row.get("決まり手", "")).strip()

        for rank in range(1, 7):
            racer_id_col = f"{rank}着_登録番号"
            boat_no_col = f"{rank}着_艇番"

            racer_id = str(row.get(racer_id_col, "")).strip()
            boat_no_raw = row.get(boat_no_col, "")

            if not racer_id or racer_id in ("nan", ""):
                continue
            try:
                boat_no = int(boat_no_raw)
            except (ValueError, TypeError):
                continue

            frame_rows.append({
                "racer_id": racer_id,
                "frame": boat_no,
                "rank": rank,
            })

            if rank == 1 and winning_technique in WINNING_TECHNIQUES:
                wt_rows.append({
                    "racer_id": racer_id,
                    "technique": winning_technique,
                })

    return pd.DataFrame(frame_rows), pd.DataFrame(wt_rows)


def _aggregate(frame_df: pd.DataFrame, wt_df: pd.DataFrame) -> pd.DataFrame:
    """
    全日分を集計して stats DataFrame を作る。

    stats の列:
      racer_id, frame,
      races (出走数), rank1, rank2, rank3 (各着数),
      wt_nige, wt_sashi, wt_makuri, wt_makuri_sashi, wt_nuki, wt_megumare
      (各決まり手での1着数)
    """
    if frame_df.empty:
        return pd.DataFrame()

    # 枠別集計
    frame_agg = (
        frame_df.groupby(["racer_id", "frame"])
        .apply(lambda g: pd.Series({
            "races": len(g),
            "rank1": (g["rank"] == 1).sum(),
            "rank2": (g["rank"] == 2).sum(),
            "rank3": (g["rank"] == 3).sum(),
        }), include_groups=False)
        .reset_index()
    )

    # 決まり手集計（1着時のみ）
    wt_col_map = {
        "逃げ": "wt_nige",
        "差し": "wt_sashi",
        "まくり": "wt_makuri",
        "まくり差し": "wt_makuri_sashi",
        "抜き": "wt_nuki",
        "恵まれ": "wt_megumare",
    }
    if not wt_df.empty:
        wt_agg = (
            wt_df.groupby(["racer_id", "technique"])
            .size()
            .reset_index(name="cnt")
        )
        wt_pivot = wt_agg.pivot(index="racer_id", columns="technique", values="cnt").fillna(0)
        wt_pivot.columns = [wt_col_map.get(c, c) for c in wt_pivot.columns]
        wt_pivot = wt_pivot.reset_index()
    else:
        wt_pivot = pd.DataFrame(columns=["racer_id"] + list(wt_col_map.values()))

    # 結合
    stats = frame_agg.merge(wt_pivot, on="racer_id", how="left")
    for col in wt_col_map.values():
        if col not in stats.columns:
            stats[col] = 0
        else:
            stats[col] = stats[col].fillna(0).astype(int)

    return stats


def build_stats(start_year: int = DATA_START_YEAR) -> None:
    """
    全期間の results を取得して stats.parquet を生成する（初回用）。
    """
    today = datetime.date.today()
    all_frame: list[pd.DataFrame] = []
    all_wt: list[pd.DataFrame] = []

    current = datetime.date(start_year, 1, 1)
    while current < today:
        df = _fetch_csv(current.year, current.month, current.day)
        if df is not None:
            f, w = _process_df(df)
            all_frame.append(f)
            all_wt.append(w)
        current += datetime.timedelta(days=1)

    frame_df = pd.concat(all_frame, ignore_index=True) if all_frame else pd.DataFrame()
    wt_df = pd.concat(all_wt, ignore_index=True) if all_wt else pd.DataFrame()

    stats = _aggregate(frame_df, wt_df)
    STATS_PATH.parent.mkdir(parents=True, exist_ok=True)
    stats.to_parquet(STATS_PATH, index=False)
    META_PATH.write_text(str(today - datetime.timedelta(days=1)))


def update_stats() -> None:
    """
    前回更新日の翌日から昨日までの差分を stats.parquet に追記する。
    """
    if not STATS_PATH.exists():
        build_stats()
        return

    last_date = datetime.date.fromisoformat(META_PATH.read_text().strip())
    today = datetime.date.today()
    yesterday = today - datetime.timedelta(days=1)

    if last_date >= yesterday:
        return  # すでに最新

    existing = pd.read_parquet(STATS_PATH)
    all_frame: list[pd.DataFrame] = []
    all_wt: list[pd.DataFrame] = []

    current = last_date + datetime.timedelta(days=1)
    while current <= yesterday:
        df = _fetch_csv(current.year, current.month, current.day)
        if df is not None:
            f, w = _process_df(df)
            all_frame.append(f)
            all_wt.append(w)
        current += datetime.timedelta(days=1)

    if not all_frame:
        META_PATH.write_text(str(yesterday))
        return

    frame_df = pd.concat(all_frame, ignore_index=True)
    wt_df = pd.concat(all_wt, ignore_index=True) if all_wt else pd.DataFrame()
    new_stats = _aggregate(frame_df, wt_df)

    # 既存と加算マージ
    numeric_cols = ["races", "rank1", "rank2", "rank3",
                    "wt_nige", "wt_sashi", "wt_makuri",
                    "wt_makuri_sashi", "wt_nuki", "wt_megumare"]
    merged = existing.merge(new_stats, on=["racer_id", "frame"],
                             how="outer", suffixes=("_old", "_new"))
    for col in numeric_cols:
        old_c, new_c = f"{col}_old", f"{col}_new"
        if old_c in merged.columns and new_c in merged.columns:
            merged[col] = merged[old_c].fillna(0) + merged[new_c].fillna(0)
        elif old_c in merged.columns:
            merged[col] = merged[old_c].fillna(0)
        elif new_c in merged.columns:
            merged[col] = merged[new_c].fillna(0)
        else:
            merged[col] = 0

    result = merged[["racer_id", "frame"] + numeric_cols].copy()
    result[numeric_cols] = result[numeric_cols].astype(int)
    result.to_parquet(STATS_PATH, index=False)
    META_PATH.write_text(str(yesterday))


def load_stats() -> pd.DataFrame:
    """stats.parquet を読み込んで返す。なければ空 DataFrame。"""
    if not STATS_PATH.exists():
        return pd.DataFrame()
    return pd.read_parquet(STATS_PATH)


def get_racer_stats(stats: pd.DataFrame, racer_id: str) -> dict:
    """
    特定選手の統計を辞書で返す。

    Returns
    -------
    {
      frame_stats: {
        1: {"rate1": 55.9, "rate2": 81.2, "rate3": 88.4},
        ...
        6: {...}
      },
      technique_stats: {
        "逃げ": 45.5, "差し": 14.0, "まくり": 19.0,
        "まくり差し": 11.0, "抜き": X.X, "恵まれ": X.X
      }
    }
    """
    if stats.empty or racer_id not in stats["racer_id"].values:
        return {"frame_stats": {}, "technique_stats": {}}

    df = stats[stats["racer_id"] == racer_id]

    # 枠別成績
    frame_stats = {}
    for _, row in df.iterrows():
        frame = int(row["frame"])
        races = int(row["races"])
        if races == 0:
            continue
        frame_stats[frame] = {
            "rate1": round(row["rank1"] / races * 100, 1),
            "rate2": round((row["rank1"] + row["rank2"]) / races * 100, 1),
            "rate3": round((row["rank1"] + row["rank2"] + row["rank3"]) / races * 100, 1),
        }

    # 決まり手傾向（1着時の割合）
    wt_cols = {
        "逃げ": "wt_nige", "差し": "wt_sashi", "まくり": "wt_makuri",
        "まくり差し": "wt_makuri_sashi", "抜き": "wt_nuki", "恵まれ": "wt_megumare",
    }
    total_wins = df["wt_nige"].sum() + df["wt_sashi"].sum() + df["wt_makuri"].sum() \
        + df["wt_makuri_sashi"].sum() + df["wt_nuki"].sum() + df["wt_megumare"].sum()

    technique_stats = {}
    if total_wins > 0:
        for label, col in wt_cols.items():
            if col in df.columns:
                technique_stats[label] = round(df[col].sum() / total_wins * 100, 1)
            else:
                technique_stats[label] = 0.0
    return {"frame_stats": frame_stats, "technique_stats": technique_stats}
