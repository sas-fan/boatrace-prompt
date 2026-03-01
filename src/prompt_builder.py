"""
スクレイピングデータ・統計データをプロンプトテンプレートに埋め込む。
"""

PROMPT_TEMPLATE = """\
あなたは競艇予想の専門家AIです。以下のレース情報を分析し、予想を行ってください。

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

【競艇の基本知識】
競艇はインコース（内枠）が圧倒的に有利なスポーツです。
- 1号艇の1着率は約50%、3連対率は約75%
- 枠順の有利さ: 1号艇 >> 2号艇 > 3号艇 > 4号艇 > 5号艇 > 6号艇
- 1号艇がB級でも、外枠のA1級選手より有利なことが多い
- 1号艇が負けるのは、主にスタート失敗（出遅れ）や、外からの「まくり」「差し」

【予想の考え方】
1. まず1号艇が逃げ切れるかを判断する
   - 1号艇のスタート力（ST展示）を確認
   - 1号艇の全国勝率・当地勝率を確認
   - F（フライング）持ちの場合はスタートが慎重になりやすい
   - L（出遅れ）持ちはスタート事故リスクが高く、ST展示が良くても本番で出遅れる可能性を加味して評価を下げる
2. 1号艇が逃げ切れそうなら「1-X-X」の形を基本とする
3. 1号艇が崩れそうな場合のみ、2〜4号艇の「まくり」「差し」を考慮
4. 5号艇・6号艇の1着は実力差がないと難しい

【分析のポイント】
- 1号艇のスタート展示（0.10秒以内なら好スタート傾向）
- 外枠にA1級がいても1号艇が逃げるケースが多い
- モーター連対率が30%以上は好調モーター
- 当地勝率が高い選手はその会場に適性がある

【追加のドメイン知識（判断の精度を上げるための定石）】
- 枠の有利不利は「スタートで並ぶ」ことが前提。1号艇が凹む（出遅れ/伸び負け）と一気に波乱化しやすい
- ST展示は当日の気配の重要指標だが、展示は安全寄りになりやすい。F/L持ちは本番の再現性が落ちやすい
- 展示タイムは相対比較が重要（同一レース内での上位/下位）。僅差でも「伸び足・回り足」の差として扱う
- チルトは+で伸び寄り、-で回り足寄りになりやすい（一般論）。風・波が強いほど旋回力/安定感が効きやすい
- モーター連対率が低い選手は「展開待ち」になりやすい。逆にモーターが強い外枠はまくり/まくり差しの評価を上げる
- 3連単は点数が増えるほど期待値が下がりやすい。自信が薄いときは推奨点数を絞るか「見」を選ぶ
- 基本形の作り方:
  - 1号艇が逃げ濃厚: 1着固定（1-2/3/4-2/3/4中心、押さえで外枠絡み）
  - 1号艇が不安: 2〜4の頭（まくり/差し/まくり差し）を厚くし、1は2-3着付けも検討
  - 5/6の頭は特殊条件（明確な実力差や当日の気配差）がない限り低評価

【推奨買い目について】
プロの予想家は、条件が揃わないレースでは「見（けん）」といって買わない選択もします。
- 荒れそうな展開が読めない、または展開が全く読めない場合は推奨0点もあり
- 推奨点数0は「このレースは買わない方が良い」という判断を意味する
- 逆に、自信があれば推奨点数を多く（5点以上）にしても良い
- 期待値が高い時のみ購入することが回収率向上の鍵

【推論理由（reasoning）の必須要件：ここを最優先で守る】
以下を満たさない推論理由は「未達」です。**200〜400文字**で、**改行なし**で書いてください。
1) 1号艇の評価を必ず含める（逃げ切り可否、崩れるなら原因）
2) 数値根拠（枠別成績）を最低1回引用する（例: 「1号艇 枠別58.2/77.4/87.0」）
3) 数値根拠（決まり手傾向）を最低1回引用する（例: 「1号艇 逃げ48.9%」や「3号艇 まくり差し15.6%」）
4) 直前情報/条件の根拠を最低1つ入れる（展示ST/展示タイム/モーター/風波/F/Lなど）
※枠別成績や決まり手が「データなし」の艇がある場合は、その旨を書き、代替根拠（展示/勝率/モーター等）で補う
※200文字未満になりそうな場合は、無意味な水増しはせず「対抗評価（2〜4号艇）」「荒れ要因」「買い目の形（1-2-3中心等）」など"根拠の追加"で文字数を満たすこと

【表記ルール（単位・記号の厳格化）】
- 「展示タイム」「展示ST（スタート展示）」は**秒の値**だが、推論理由では単位「秒」を付けず**数値のみ**で書く（例: 「展示ST0.12」「展示タイム6.75」）
- 「風速」「気温」「水温」「波高」などは、可能なら単位を明記する（例: 「風速5m」「波高5cm」）
- 「勝率」「連対率」「枠別成績」「決まり手割合」など**割合**は必ず「%」を付ける（例: 「逃げ48.9%」「モーター連対率37.2%」）
- 枠別成績の「A/B/C」の誤説明は禁止。**A=1着率、B=2着率、C=3着率（いずれも%）**として明確に説明する（例: 「1号艇 枠別A/B/C=58.2/77.4/87.0%（A=1着率,B=2着率,C=3着率）」）

【reasoningの書き方テンプレ（この順でOK）】
「1号艇評価: …。数値根拠: 1号艇 枠別…、決まり手…（必要なら対抗も）。直前要因: …。結論: 本命…、相手…（荒れ要因があれば一言）」

【舟券の種類】
- 3連単: 1着・2着・3着を順番通りに当てる（120通り）。形式: "1-2-3"
- 3連複: 1着・2着・3着を順番関係なく当てる（20通り）。形式: "1=2=3"（数字は小さい順に並べる）
- 2連単: 1着・2着を順番通りに当てる（30通り）。形式: "1-2"
- 2連複: 1着・2着を順番関係なく当てる（15通り）。形式: "1=2"（数字は小さい順に並べる）
"""


def _fmt_fl(f_count: str, l_count: str) -> str:
    """F/L情報をフォーマットする。0なら省略。"""
    parts = []
    if f_count and f_count != "0":
        parts.append(f"F{f_count}")
    if l_count and l_count != "0":
        parts.append(f"L{l_count}")
    return " ".join(parts) if parts else ""


def _fmt_frame_stats(frame_stats: dict, frame_no: int) -> str:
    """枠別成績を "R1/R2/R3%" 形式にフォーマット。データなし時は "データなし"。"""
    s = frame_stats.get(frame_no)
    if not s:
        return "データなし"
    return f"{s['rate1']}%/{s['rate2']}%/{s['rate3']}%"


def _fmt_technique(tech: dict) -> str:
    """決まり手傾向を "逃げ X% / 差し X% / ..." 形式にフォーマット。"""
    if not tech:
        return "データなし"
    order = ["逃げ", "まくり", "差し", "まくり差し", "抜き", "恵まれ"]
    parts = []
    for key in order:
        val = tech.get(key, 0.0)
        if val > 0:
            parts.append(f"{key} {val}%")
    return " / ".join(parts) if parts else "データなし"


def build_prompt(
    racelist: dict,
    beforeinfo: dict,
    stats_by_racer: dict,
) -> str:
    """
    プロンプトを組み立てて返す。

    Parameters
    ----------
    racelist       : get_racelist() の返り値
    beforeinfo     : get_beforeinfo() の返り値
    stats_by_racer : {racer_id: get_racer_stats() の返り値}
    """
    # 展示情報を艇番で引けるようにする
    exhibit_map = {b["boat_no"]: b for b in beforeinfo.get("boats", [])}

    # ---- 出走表セクション ----
    racelist_lines = []
    for boat in racelist.get("boats", []):
        bn = boat["boat_no"]
        fl = _fmt_fl(boat["f_count"], boat["l_count"])
        fl_suffix = f" {fl}" if fl else ""
        racelist_lines.append(
            f"{bn}号艇: {boat['racer_name']} ({boat['grade']}) "
            f"全国勝率{boat['national_rate']} "
            f"当地勝率{boat['local_rate']} "
            f"モーター連対率{boat['motor_rate']}%"
            f"{fl_suffix}"
        )
    racelist_section = "\n".join(racelist_lines)

    # ---- 枠別成績セクション ----
    frame_lines = []
    for boat in racelist.get("boats", []):
        bn = boat["boat_no"]
        racer_stats = stats_by_racer.get(boat["racer_id"], {})
        frame_stats = racer_stats.get("frame_stats", {})
        frame_lines.append(
            f"{bn}号艇: {_fmt_frame_stats(frame_stats, bn)}"
        )
    frame_stats_section = "\n".join(frame_lines)

    # ---- 決まり手傾向セクション ----
    technique_lines = []
    for boat in racelist.get("boats", []):
        bn = boat["boat_no"]
        racer_stats = stats_by_racer.get(boat["racer_id"], {})
        tech = racer_stats.get("technique_stats", {})
        technique_lines.append(
            f"{bn}号艇: {_fmt_technique(tech)}"
        )
    technique_stats_section = "\n".join(technique_lines)

    # ---- 展示情報セクション ----
    exhibit_lines = []
    for boat in racelist.get("boats", []):
        bn = boat["boat_no"]
        ex = exhibit_map.get(bn, {})
        exhibit_lines.append(
            f"{bn}号艇: "
            f"展示タイム{ex.get('exhibit_time', '---')}秒 "
            f"チルト{ex.get('tilt', '---')} "
            f"ST展示{ex.get('st_exhibit', '---')}秒"
        )
    exhibit_section = "\n".join(exhibit_lines)

    return PROMPT_TEMPLATE.format(
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
    )
