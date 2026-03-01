"""
競艇予想プロンプト生成ツール
"""
import datetime
import sys
from pathlib import Path

import streamlit as st

sys.path.insert(0, str(Path(__file__).parent))
from src.scraper import get_racelist, get_beforeinfo, STADIUM_MAP
from src.stats import load_stats, update_stats, build_stats, STATS_PATH
from src.prompt_builder import build_prompt
from src.stats import get_racer_stats

st.set_page_config(
    page_title="競艇予想プロンプト生成",
    page_icon="🚤",
    layout="centered",
)

st.title("🚤 競艇予想プロンプト生成")
st.caption("boatrace.jp から出走表・展示情報を取得し、AIへのプロンプトを自動生成します。")

# ---- 統計データの準備 ----
@st.cache_resource(show_spinner="選手統計データを準備中...")
def prepare_stats():
    if not STATS_PATH.exists():
        st.toast("初回: 過去データを取得・集計します（数分かかります）")
        build_stats()
    else:
        update_stats()
    return load_stats()


stats_df = prepare_stats()

# ---- サイドバー: 入力 ----
with st.sidebar:
    st.header("レース選択")

    race_date = st.date_input(
        "日付",
        value=datetime.date.today(),
        min_value=datetime.date(2020, 1, 1),
        max_value=datetime.date.today(),
    )

    stadium_options = list(STADIUM_MAP.items())  # [(jcd, name), ...]
    stadium_labels = [f"{name}（{jcd}）" for jcd, name in stadium_options]
    stadium_idx = st.selectbox(
        "レース場",
        options=range(len(stadium_options)),
        format_func=lambda i: stadium_labels[i],
    )
    jcd = stadium_options[stadium_idx][0]

    race_no = st.selectbox(
        "レース番号",
        options=list(range(1, 13)),
        format_func=lambda n: f"{n}R",
    )

    generate_btn = st.button("プロンプト生成", type="primary", use_container_width=True)

    st.divider()
    st.caption(
        "統計データ更新日: "
        + (
            (Path(__file__).parent / "data" / "stats_meta.txt").read_text().strip()
            if (Path(__file__).parent / "data" / "stats_meta.txt").exists()
            else "未取得"
        )
    )

# ---- メインエリア ----
if generate_btn:
    date_str = race_date.strftime("%Y%m%d")

    with st.spinner("データ取得中..."):
        try:
            racelist = get_racelist(jcd, date_str, race_no)
        except Exception as e:
            st.error(f"出走表の取得に失敗しました: {e}")
            st.stop()

        try:
            beforeinfo = get_beforeinfo(jcd, date_str, race_no)
        except Exception as e:
            st.warning(f"展示情報の取得に失敗しました（展示未公開の可能性）: {e}")
            beforeinfo = {
                "weather": "", "temperature": "", "wind_speed": "",
                "wind_dir": "", "water_temp": "", "wave_height": "",
                "boats": [],
            }

    # 統計を各選手で取得
    stats_by_racer = {}
    for boat in racelist.get("boats", []):
        rid = boat["racer_id"]
        stats_by_racer[rid] = get_racer_stats(stats_df, rid)

    prompt = build_prompt(racelist, beforeinfo, stats_by_racer)

    stadium_name = racelist.get("stadium", "")
    st.subheader(
        f"{race_date.strftime('%Y/%m/%d')} {stadium_name} {race_no}R"
    )

    # 出走表プレビュー
    with st.expander("出走表プレビュー", expanded=False):
        for boat in racelist.get("boats", []):
            st.write(
                f"**{boat['boat_no']}号艇** {boat['racer_name']} "
                f"({boat['grade']}) "
                f"全国{boat['national_rate']} / 当地{boat['local_rate']}"
            )

    # プロンプト表示
    st.text_area(
        "生成されたプロンプト（コピーしてAIに貼り付けてください）",
        value=prompt,
        height=500,
        key="prompt_area",
    )

    # コピーボタン（JavaScriptで実装）
    st.components.v1.html(
        f"""
        <button onclick="copyToClipboard()" style="
            background-color: #0068C9;
            color: white;
            padding: 8px 20px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            margin-top: 4px;
        ">📋 クリップボードにコピー</button>
        <span id="copied_msg" style="
            color: green; margin-left: 12px; font-size: 13px; display: none;
        ">✅ コピーしました！</span>
        <script>
        function copyToClipboard() {{
            const text = {repr(prompt)};
            navigator.clipboard.writeText(text).then(() => {{
                const msg = document.getElementById('copied_msg');
                msg.style.display = 'inline';
                setTimeout(() => {{ msg.style.display = 'none'; }}, 2000);
            }});
        }}
        </script>
        """,
        height=60,
    )
else:
    st.info("サイドバーで日付・レース場・レース番号を選択し、「プロンプト生成」を押してください。")
