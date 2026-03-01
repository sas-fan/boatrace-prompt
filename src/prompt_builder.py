"""
スクレイピングデータ・統計データをプロンプトテンプレートに埋め込む。
"""

# 競艇場ごとのイン有利傾向コメント
STADIUM_TENDENCY = {
    "01": "桐生はインがやや弱め。スタートが速い外枠がまくりに来やすい傾向。",
    "02": "戸田は標準的なイン有利。ただし水面が狭くスタートが混戦になりやすい。",
    "03": "江戸川はインが全国最弱クラス。潮位・流れの影響で外枠が有利になりやすい。",
    "04": "平和島はインがやや弱め。追い風・横風が強いと差しが決まりやすい。",
    "05": "多摩川はインがやや強め。静水面でスタートが決まればイン有利。",
    "06": "浜名湖は標準的なイン有利。風が強いと荒れやすい。",
    "07": "蒲郡はインが強め。安定した水面でイン逃げが決まりやすい。",
    "08": "常滑はインがやや強め。追い風になると差しが増える傾向。",
    "09": "津は標準的なイン有利。風の影響を受けやすい水面。",
    "10": "三国は標準的なイン有利。風が強い日はまくりが有効。",
    "11": "びわこはインがやや弱め。波が出やすく外枠が台頭しやすい。",
    "12": "住之江は標準的なイン有利。インが安定している室内レース場。",
    "13": "尼崎は標準的なイン有利。静水面で比較的イン有利。",
    "14": "鳴門は標準的なイン有利。潮の影響で水面が変化しやすい。",
    "15": "丸亀はインがやや強め。瀬戸内の穏やかな水面。",
    "16": "児島はインがやや強め。風向きによって差しが増える。",
    "17": "宮島はインがやや弱め。潮と風の影響でアウトが台頭しやすい。",
    "18": "徳山は標準的なイン有利。",
    "19": "下関は標準的なイン有利。",
    "20": "若松は標準的なイン有利。",
    "21": "芦屋はインがやや強め。静水面でイン有利が続きやすい。",
    "22": "福岡は標準的なイン有利。",
    "23": "唐津はインがやや強め。",
    "24": "大村はインが全国最強クラス。1号艇逃げ率が極めて高い。",
}

PROMPT_TEMPLATE = """\
あなたは競艇予想の専門家AIです。以下のレース情報を分析し、予想を行ってください。

【対象レース】
{race_info_line}

【出走表】
{racelist_section}

【選手の枠別成績（過去全データ）】
※算出方法: 対象選手の過去全出走から「該当枠で出走したレース」を抽出し、
  1着率=1着数/出走数, 2連対率=1-2着数/出走数, 3連対率=1-3着数/出走数（いずれも%）
{frame_stats_section}

【選手の決まり手傾向（過去全データ・1着時）】
※算出方法: 対象選手の過去全出走から「1着のレースのみ」を抽出し、
  各決まり手の割合=（その決まり手での1着数）/（総1着数）（%）
{technique_stats_section}

【展示情報】
{exhibit_section}

【気象条件】
天気: {weather}
気温: {temperature}℃
風: {wind_dir} {wind_speed}m
水温: {water_temp}℃
波高: {wave_height}cm

【専門家評価】
以下は各分野の専門家による事前評価です。予想の参考にしてください。

■ モーター専門家
{expert_motor}

■ 競艇場専門家
{expert_stadium}

■ 展開予想専門家
{expert_development}

■ 今節実績専門家
{expert_session}

■ 展示専門家
{expert_exhibit}

■ 大穴専門家
{expert_upset}

■ 天候専門家
{expert_weather}

【直前オッズ（3連単・120通り）】
{odds_section}

【期待値の考え方】
- 期待値 = 推定的中確率(%) × オッズ ÷ 100
- 期待値 > 1.0 → 購入推奨（理論上プラス収支）
- 期待値 < 1.0 → 見送り推奨
- 推奨買い目には「オッズXX倍・推定確率X%・期待値X.X」を必ず記載すること
- オッズが低い（人気）買い目ほど的中確率が高くないと期待値がマイナスになることを意識すること
- 高配当（オッズ50倍超）でも根拠のある波乱シナリオには価値がある

【競艇の基本知識】
競艇はインコース（内側の枠）が統計的に有利なスポーツですが、選手の実力・モーター・気象条件・当日の展示気配によって優位性は大きく変動します。
- インコース（1〜3号艇）の逃げ・差し決着は多いが、外枠からのまくり・まくり差しが決まることも頻繁にある
- 1号艇が有利な傾向はあるが、モーター不調・F/L持ちによるスタートリスク・外枠の実力次第で容易に逆転が起こる
- 各艇の評価はモーター連対率・枠別過去成績・ST展示・今節実績など複数の指標を総合して行う
- 「枠有利を過信しない」「当日データと気配を重視する」ことが回収率向上の鍵

【予想の考え方】
1. 全艇をフラットに評価する
   - 全国勝率・当地勝率・モーター連対率・枠別過去成績・今節実績を全艇で横断比較する
   - ST展示・展示タイム・チルトなど「当日の気配」を全艇で比較し、突出した艇を見つける
   - F/L持ちはスタートリスクとして全艇で確認し、内外問わず評価に反映する
2. 展開シナリオを複数立てる
   - イン逃げ展開（内枠が先手を取る）
   - まくり展開（外枠が第1ターンマーク前で一気にかわす）
   - 差し展開（内の隙間を外枠が突く）
3. 各シナリオとオッズから期待値を算出し、期待値>1.0の買い目に絞る
4. 自信が持てない場合は「見（けん）」を選ぶ

【分析のポイント】
- ST展示は全艇で比較する（0.10秒以内が好スタート傾向の目安）
- モーター連対率30%以上は好調モーター（外枠でも逆転力がある）
- 当地勝率が高い選手はその水面への適性を加味する
- F持ち選手はスタートが慎重になりやすい（内外問わずリスクとして評価する）
- 展示タイムは同一レース内での相対比較が重要（僅差でも「伸び足・回り足」の差として扱う）

【追加のドメイン知識（判断の精度を上げるための定石）】
- 枠の有利不利は「スタートで並ぶ」ことが前提。内枠でもスタートが凹む（出遅れ/伸び負け）と一気に波乱化しやすい
- ST展示は当日の気配の重要指標だが、展示は安全寄りになりやすい。F/L持ちは本番の再現性が落ちやすい
- 展示タイムは相対比較が重要（同一レース内での上位/下位）。僅差でも「伸び足・回り足」の差として扱う
- チルトは+で伸び寄り、-で回り足寄りになりやすい（一般論）。風・波が強いほど旋回力/安定感が効きやすい
- モーター連対率が低い選手は「展開待ち」になりやすい。逆にモーターが強い外枠はまくり/まくり差しの評価を上げる
- 3連単は点数が増えるほど期待値が下がりやすい。自信が薄いときは推奨点数を絞るか「見」を選ぶ
- 軸の決め方:
  - 複数指標（勝率・モーター・ST展示・枠別成績）で最上位の艇を1着軸の候補にする（必ずしも内枠ではない）
  - オッズが低すぎる軸（1.5倍以下）は期待値上、見送りも検討
  - 複数の展開シナリオが想定されるときは「軸2頭」か「ボックス流し」も有効
  - 5・6号艇の1着はモーター最上位・ST展示最積極・F持ち選手が多い等、具体的な根拠がある場合のみ評価する

【推奨買い目について】
プロの予想家は、条件が揃わないレースでは「見（けん）」といって買わない選択もします。
- 荒れそうな展開が読めない、または展開が全く読めない場合は推奨0点もあり
- 推奨点数0は「このレースは買わない方が良い」という判断を意味する
- 逆に、自信があれば推奨点数を多く（5点以上）にしても良い
- 期待値が高い時のみ購入することが回収率向上の鍵

【推論理由（reasoning）の必須要件：ここを最優先で守る】
以下を満たさない推論理由は「未達」です。**200〜400文字**で、**改行なし**で書いてください。
1) 本命艇（1〜2艇）の評価を含める（枠別成績・勝率・ST展示・モーターなどの数値から判断した根拠）
2) 数値根拠（枠別成績）を最低1回引用する（例: 「3号艇 枠別45.0/68.2/82.0」）
3) 数値根拠（決まり手傾向）を最低1回引用する（例: 「2号艇 差し28.4%」や「4号艇 まくり差し20.1%」）
4) 直前情報/条件の根拠を最低1つ入れる（展示ST/展示タイム/モーター/風波/F/Lなど）
※枠別成績や決まり手が「データなし」の艇がある場合は、その旨を書き、代替根拠（展示/勝率/モーター等）で補う
※200文字未満になりそうな場合は、無意味な水増しはせず「対抗評価」「波乱要因」「買い目の形と期待値根拠」など根拠の追加で文字数を満たすこと

【表記ルール（単位・記号の厳格化）】
- 「展示タイム」「展示ST（スタート展示）」は**秒の値**だが、推論理由では単位「秒」を付けず**数値のみ**で書く（例: 「展示ST0.12」「展示タイム6.75」）
- 「風速」「気温」「水温」「波高」などは、可能なら単位を明記する（例: 「風速5m」「波高5cm」）
- 「勝率」「連対率」「枠別成績」「決まり手割合」など**割合**は必ず「%」を付ける（例: 「逃げ48.9%」「モーター連対率37.2%」）
- 枠別成績の「A/B/C」の誤説明は禁止。**A=1着率、B=2着率、C=3着率（いずれも%）**として明確に説明する（例: 「1号艇 枠別A/B/C=58.2/77.4/87.0%（A=1着率,B=2着率,C=3着率）」）

【reasoningの書き方テンプレ（この順でOK）】
「本命評価: ○号艇…（理由）。数値根拠: ○号艇 枠別…、決まり手…（必要なら対抗艇も）。直前要因: …。結論: 本命…、相手…（波乱要因があれば一言）」

【舟券の種類】
- 3連単: 1着・2着・3着を順番通りに当てる（120通り）。形式: "1-2-3"
- 3連複: 1着・2着・3着を順番関係なく当てる（20通り）。形式: "1=2=3"（数字は小さい順に並べる）
- 2連単: 1着・2着を順番通りに当てる（30通り）。形式: "1-2"
- 2連複: 1着・2着を順番関係なく当てる（15通り）。形式: "1=2"（数字は小さい順に並べる）
"""


# ---- ヘルパー関数 ----

def _fmt_fl(f_count: str, l_count: str) -> str:
    parts = []
    if f_count and f_count != "0":
        parts.append(f"F{f_count}")
    if l_count and l_count != "0":
        parts.append(f"L{l_count}")
    return " ".join(parts) if parts else ""


def _fmt_frame_stats(frame_stats: dict, frame_no: int) -> str:
    s = frame_stats.get(frame_no)
    if not s:
        return "データなし"
    return f"{s['rate1']}%/{s['rate2']}%/{s['rate3']}%"


def _fmt_technique(tech: dict) -> str:
    if not tech:
        return "データなし"
    order = ["逃げ", "まくり", "差し", "まくり差し", "抜き", "恵まれ"]
    parts = [f"{k} {tech[k]}%" for k in order if tech.get(k, 0) > 0]
    return " / ".join(parts) if parts else "データなし"


def _rank_by(boats: list[dict], key: str, reverse: bool = True) -> list[tuple]:
    """指定キーでソートし (艇番, 値) リストを返す。値が空・0 は末尾。"""
    def _val(b):
        try:
            return float(b.get(key, 0) or 0)
        except (ValueError, TypeError):
            return 0.0
    return sorted(
        [(b["boat_no"], _val(b)) for b in boats],
        key=lambda x: x[1],
        reverse=reverse,
    )


# ---- 専門家コメント生成 ----

def _expert_motor(boats: list[dict], bi_boats: list[dict]) -> str:
    """モーター専門家: モーター連対率・展示タイムの順位評価。"""
    motor_rank = _rank_by(boats, "motor_rate", reverse=True)
    exhibit_rank = _rank_by(bi_boats, "exhibit_time", reverse=False)  # 小さいほど速い

    lines = []
    top_motor_no, top_motor_val = motor_rank[0]
    lines.append(f"モーター連対率1位: {top_motor_no}号艇（{top_motor_val:.1f}%）")

    # 2位以降で30%超もあれば言及
    strong = [f"{n}号艇({v:.1f}%)" for n, v in motor_rank[1:] if v >= 30]
    if strong:
        lines.append(f"好調モーター他: {', '.join(strong)}")

    # 展示タイム
    top_ex_no, top_ex_val = exhibit_rank[0]
    lines.append(f"展示タイム最速: {top_ex_no}号艇（{top_ex_val:.2f}秒）")
    bottom_ex_no, bottom_ex_val = exhibit_rank[-1]
    lines.append(f"展示タイム最遅: {bottom_ex_no}号艇（{bottom_ex_val:.2f}秒）")

    # 1号艇のモーター位置
    boat1_motor_pos = next((i + 1 for i, (n, _) in enumerate(motor_rank) if n == 1), None)
    boat1_ex_pos = next((i + 1 for i, (n, _) in enumerate(exhibit_rank) if n == 1), None)
    boat1 = next((b for b in boats if b["boat_no"] == 1), None)
    if boat1:
        lines.append(
            f"1号艇モーター連対率{boat1['motor_rate']}%（6艇中{boat1_motor_pos}位）、"
            f"展示タイム{boat1_ex_pos}位"
        )
    return "。".join(lines) + "。"


def _expert_stadium(boats: list[dict], jcd: str) -> str:
    """競艇場専門家: 当地勝率ランキング + 場の特性。"""
    local_rank = _rank_by(boats, "local_rate", reverse=True)
    tendency = STADIUM_TENDENCY.get(jcd, "")

    lines = [tendency] if tendency else []
    top3 = [f"{n}号艇（{v:.2f}）" for n, v in local_rank[:3] if v > 0]
    lines.append(f"当地勝率上位: {', '.join(top3)}")

    # 1号艇の当地順位
    boat1_pos = next((i + 1 for i, (n, _) in enumerate(local_rank) if n == 1), None)
    boat1 = next((b for b in boats if b["boat_no"] == 1), None)
    if boat1:
        lines.append(f"1号艇当地勝率{boat1['local_rate']}（6艇中{boat1_pos}位）")
    return "。".join(lines) + "。"


def _expert_development(boats: list[dict], stats_by_racer: dict) -> str:
    """展開予想専門家: 決まり手傾向・枠別成績から展開シナリオを提示。"""
    lines = []

    boat1 = next((b for b in boats if b["boat_no"] == 1), None)
    if boat1:
        rs = stats_by_racer.get(boat1["racer_id"], {})
        fs = rs.get("frame_stats", {}).get(1, {})
        ts = rs.get("technique_stats", {})
        r1 = fs.get("rate1", 0)
        nige = ts.get("逃げ", 0)
        if r1 > 0:
            lines.append(f"1号艇の枠別1着率{r1}%、逃げ{nige}%")
        else:
            lines.append("1号艇の過去統計データなし（当日気配で判断）")

    # まくり/差しが強い外枠を探す
    threats = []
    for b in boats:
        if b["boat_no"] <= 1:
            continue
        rs = stats_by_racer.get(b["racer_id"], {})
        ts = rs.get("technique_stats", {})
        makuri = ts.get("まくり", 0) + ts.get("まくり差し", 0)
        if makuri >= 25:
            threats.append(f"{b['boat_no']}号艇（まくり系{makuri:.1f}%）")
    if threats:
        lines.append(f"まくり/まくり差し傾向が強い: {', '.join(threats)}")
    else:
        lines.append("外枠のまくり傾向は標準的")

    return "。".join(lines) + "。"


def _expert_session(boats: list[dict]) -> str:
    """今節実績専門家: 今節着順リストから調子を評価。"""
    lines = []
    for b in boats:
        results = b.get("recent_results", [])
        if not results:
            continue
        # 数値のみの着順を抽出（F/Lなどを除く）
        numeric = [int(r) for r in results if r.isdigit()]
        if not numeric:
            continue
        avg = sum(numeric) / len(numeric)
        trend = "好調" if avg <= 2.5 else ("普通" if avg <= 4.0 else "不調")
        results_str = "→".join(results[-4:])  # 直近4走
        lines.append(f"{b['boat_no']}号艇: 直近{results_str}（平均{avg:.1f}着・{trend}）")

    return "\n".join(lines) if lines else "今節成績データなし。"


def _expert_exhibit(bi_boats: list[dict]) -> str:
    """展示専門家: ST展示・展示タイム・チルトの評価。"""
    lines = []

    # ST展示の積極性（値が小さいほど積極的、Fは除外）
    st_list = []
    for b in bi_boats:
        st_raw = b.get("st_exhibit", "")
        if st_raw.startswith("F"):
            continue
        try:
            st_list.append((b["boat_no"], float(st_raw)))
        except (ValueError, TypeError):
            pass

    if st_list:
        st_sorted = sorted(st_list, key=lambda x: x[1])
        most_aggressive = st_sorted[0]
        lines.append(f"ST展示最積極: {most_aggressive[0]}号艇（{most_aggressive[1]:.2f}）")
        most_passive = st_sorted[-1]
        lines.append(f"ST展示最慎重: {most_passive[0]}号艇（{most_passive[1]:.2f}）")

    # 展示Fがある艇
    f_boats = [str(b["boat_no"]) for b in bi_boats if b.get("st_exhibit", "").startswith("F")]
    if f_boats:
        lines.append(f"展示F: {', '.join(f_boats)}号艇（本番は慎重スタート傾向）")

    # チルト+の艇（伸び足寄り）
    plus_tilt = [
        f"{b['boat_no']}号艇({b['tilt']})"
        for b in bi_boats
        if str(b.get("tilt", "")).startswith("+") or (
            b.get("tilt", "0") not in ("", "-0.5", "0.0", "0") and
            not str(b.get("tilt", "")).startswith("-")
        )
    ]
    if plus_tilt:
        lines.append(f"チルト+(伸び寄り): {', '.join(plus_tilt)}")

    return "。".join(lines) + "。" if lines else "展示情報なし。"


def _expert_upset(boats: list[dict], bi_boats: list[dict]) -> str:
    """大穴専門家: F/L持ち・外枠好条件から波乱要因を洗い出す。"""
    lines = []

    # F/L持ち
    fl_boats = []
    for b in boats:
        fl = _fmt_fl(b["f_count"], b["l_count"])
        if fl:
            fl_boats.append(f"{b['boat_no']}号艇({fl})")
    if fl_boats:
        lines.append(f"F/L持ち（スタート慎重傾向）: {', '.join(fl_boats)}")

    # 外枠（4〜6号艇）でモーター好調かつ展示タイム上位
    motor_rank = _rank_by(boats, "motor_rate", reverse=True)
    exhibit_rank = _rank_by(bi_boats, "exhibit_time", reverse=False)
    outer_threats = []
    for b in boats:
        if b["boat_no"] < 4:
            continue
        motor_pos = next((i + 1 for i, (n, _) in enumerate(motor_rank) if n == b["boat_no"]), 6)
        ex_pos = next((i + 1 for i, (n, _) in enumerate(exhibit_rank) if n == b["boat_no"]), 6)
        if motor_pos <= 2 or ex_pos <= 2:
            outer_threats.append(
                f"{b['boat_no']}号艇（モーター{motor_pos}位・展示{ex_pos}位）"
            )
    if outer_threats:
        lines.append(f"外枠波乱候補: {', '.join(outer_threats)}")
    else:
        lines.append("外枠に突出した波乱要因はなし")

    return "。".join(lines) + "。"


def _expert_weather(beforeinfo: dict) -> str:
    """天候専門家: 風速・波高・気象条件から展開への影響を評価。"""
    wind_speed = beforeinfo.get("wind_speed", "0") or "0"
    wind_dir = beforeinfo.get("wind_dir", "")
    wave_height = beforeinfo.get("wave_height", "0") or "0"
    temp = beforeinfo.get("temperature", "")
    water_temp = beforeinfo.get("water_temp", "")

    try:
        ws = float(wind_speed)
    except ValueError:
        ws = 0.0
    try:
        wh = float(wave_height)
    except ValueError:
        wh = 0.0

    lines = []
    if ws <= 2:
        lines.append(f"風速{ws}m・穏やかなコンディション。インが有利な標準的な展開が見込まれる")
    elif ws <= 4:
        lines.append(f"風速{ws}m・やや風あり。向かい風ならインに有利、追い風・横風なら差しが有効")
    elif ws <= 7:
        lines.append(f"風速{ws}m・風が強め。スタートが乱れやすくなり外枠の台頭に注意")
    else:
        lines.append(f"風速{ws}m・強風。荒れやすい条件。インの優位性が下がる可能性大")

    if wh >= 10:
        lines.append(f"波高{wh}cm・波が高め。回り足が重要になりチルト-の艇が有利")
    elif wh >= 5:
        lines.append(f"波高{wh}cm・やや波あり。操艇技術の差が出やすい")
    else:
        lines.append(f"波高{wh}cm・水面穏やか")

    wind_comment = f"風向は{wind_dir}。" if wind_dir else ""
    if temp:
        wind_comment += f"気温{temp}℃・水温{water_temp}℃。"
    if wind_comment:
        lines.append(wind_comment.rstrip("。"))

    return "。".join(lines) + "。"


# ---- メイン関数 ----

def _build_odds_section(odds: dict | None) -> str:
    """
    120通りの3連単オッズを「1着固定ブロック」ごとに整形して返す。
    odds が None のときは未取得メッセージを返す。
    """
    if odds is None:
        return "（オッズ未発売または取得失敗）"

    lines = []
    for first in range(1, 7):
        block = []
        for second in range(1, 7):
            if second == first:
                continue
            for third in range(1, 7):
                if third == first or third == second:
                    continue
                combo = f"{first}-{second}-{third}"
                val = odds.get(combo)
                val_str = f"{val:.1f}" if val is not None else "---"
                block.append(f"{combo}:{val_str}")
        # 1着ブロックを4列で並べる
        row_size = 4
        for i in range(0, len(block), row_size):
            lines.append("  ".join(block[i:i + row_size]))
        lines.append("")  # ブロック間の空行

    return "\n".join(lines).rstrip()


def build_prompt(
    racelist: dict,
    beforeinfo: dict,
    stats_by_racer: dict,
    odds: dict | None = None,
) -> str:
    boats = racelist.get("boats", [])
    bi_boats = beforeinfo.get("boats", [])
    exhibit_map = {b["boat_no"]: b for b in bi_boats}
    jcd = racelist.get("jcd", "")

    # 対象レース行
    date_str = racelist.get("race_date", "")
    if len(date_str) == 8:
        date_display = f"{date_str[:4]}/{date_str[4:6]}/{date_str[6:]}"
    else:
        date_display = date_str
    race_info_line = (
        f"{date_display} {racelist.get('stadium', '')} "
        f"{racelist.get('race_no', '')}R "
        f"{racelist.get('race_name', '')}"
    ).strip()

    # 出走表セクション
    racelist_lines = []
    for b in boats:
        fl = _fmt_fl(b["f_count"], b["l_count"])
        fl_suffix = f" {fl}" if fl else ""
        racelist_lines.append(
            f"{b['boat_no']}号艇: {b['racer_name']} ({b['grade']}) "
            f"全国勝率{b['national_rate']} "
            f"当地勝率{b['local_rate']} "
            f"モーター連対率{b['motor_rate']}%"
            f"{fl_suffix}"
        )
    racelist_section = "\n".join(racelist_lines)

    # 枠別成績セクション
    frame_lines = []
    for b in boats:
        rs = stats_by_racer.get(b["racer_id"], {})
        fs = rs.get("frame_stats", {})
        frame_lines.append(f"{b['boat_no']}号艇: {_fmt_frame_stats(fs, b['boat_no'])}")
    frame_stats_section = "\n".join(frame_lines)

    # 決まり手傾向セクション
    technique_lines = []
    for b in boats:
        rs = stats_by_racer.get(b["racer_id"], {})
        ts = rs.get("technique_stats", {})
        technique_lines.append(f"{b['boat_no']}号艇: {_fmt_technique(ts)}")
    technique_stats_section = "\n".join(technique_lines)

    # 展示情報セクション
    exhibit_lines = []
    for b in boats:
        ex = exhibit_map.get(b["boat_no"], {})
        exhibit_lines.append(
            f"{b['boat_no']}号艇: "
            f"展示タイム{ex.get('exhibit_time', '---')}秒 "
            f"チルト{ex.get('tilt', '---')} "
            f"ST展示{ex.get('st_exhibit', '---')}秒"
        )
    exhibit_section = "\n".join(exhibit_lines)

    # 専門家コメント
    expert_motor = _expert_motor(boats, bi_boats)
    expert_stadium = _expert_stadium(boats, jcd)
    expert_development = _expert_development(boats, stats_by_racer)
    expert_session = _expert_session(boats)
    expert_exhibit = _expert_exhibit(bi_boats)
    expert_upset = _expert_upset(boats, bi_boats)
    expert_weather = _expert_weather(beforeinfo)

    # オッズセクション
    odds_section = _build_odds_section(odds)

    return PROMPT_TEMPLATE.format(
        race_info_line=race_info_line,
        racelist_section=racelist_section,
        frame_stats_section=frame_stats_section,
        technique_stats_section=technique_stats_section,
        exhibit_section=exhibit_section,
        weather=beforeinfo.get("weather", "---"),
        temperature=beforeinfo.get("temperature", "---"),
        wind_dir=beforeinfo.get("wind_dir", "---"),
        wind_speed=beforeinfo.get("wind_speed", "---"),
        water_temp=beforeinfo.get("water_temp", "---"),
        wave_height=beforeinfo.get("wave_height", "---"),
        expert_motor=expert_motor,
        expert_stadium=expert_stadium,
        expert_development=expert_development,
        expert_session=expert_session,
        expert_exhibit=expert_exhibit,
        expert_upset=expert_upset,
        expert_weather=expert_weather,
        odds_section=odds_section,
    )
