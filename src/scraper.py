"""
boatrace.jp から出走表・展示情報・気象をスクレイピングする。
"""
import re
import warnings
import requests
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; boatrace-prompt/1.0)"}

# 競艇場コード → 名称
STADIUM_MAP = {
    "01": "桐生", "02": "戸田", "03": "江戸川", "04": "平和島",
    "05": "多摩川", "06": "浜名湖", "07": "蒲郡", "08": "常滑",
    "09": "津", "10": "三国", "11": "びわこ", "12": "住之江",
    "13": "尼崎", "14": "鳴門", "15": "丸亀", "16": "児島",
    "17": "宮島", "18": "徳山", "19": "下関", "20": "若松",
    "21": "芦屋", "22": "福岡", "23": "唐津", "24": "大村",
}

# 風向クラス番号 → テキスト（is-wind{N}）
WIND_DIR_MAP = {
    "1": "北", "2": "北北東", "3": "北東", "4": "東北東",
    "5": "東", "6": "東南東", "7": "南東", "8": "南南東",
    "9": "南", "10": "南南西", "11": "南西", "12": "西南西",
    "13": "西", "14": "西北西", "15": "北西", "16": "北北西",
    "17": "無風",
}


def _fetch(url: str) -> BeautifulSoup:
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    return BeautifulSoup(resp.text, "lxml")


def _text(tag) -> str:
    return tag.get_text(strip=True) if tag else ""


def get_racelist(jcd: str, date: str, rno: int) -> dict:
    """
    出走表を取得する。

    Parameters
    ----------
    jcd  : 場コード ("01"〜"24")
    date : 日付文字列 "YYYYMMDD"
    rno  : レース番号 (1〜12)

    Returns
    -------
    dict:
        stadium   : 場名
        race_date : 日付
        race_no   : レース番号
        boats     : list[dict] (艇番 1〜6)
            - boat_no       : 艇番
            - racer_name    : 選手名
            - racer_id      : 登録番号
            - grade         : 級別
            - national_rate : 全国勝率
            - local_rate    : 当地勝率
            - motor_rate    : モーター2連対率
            - f_count       : F数
            - l_count       : L数
    """
    url = (
        f"https://www.boatrace.jp/owpc/pc/race/racelist"
        f"?jcd={jcd}&hd={date}&rno={rno}"
    )
    soup = _fetch(url)

    boats = []
    tbodies = soup.select("div.table1.is-tableFixed__3rdadd table tbody")

    for tbody in tbodies:
        # 枠番
        boat_td = tbody.select_one("td[class*='is-boatColor']")
        if boat_td is None:
            continue
        boat_no = int(re.sub(r"\D", "", _text(boat_td)) or 0)
        if boat_no == 0:
            continue

        # 登録番号・級別・選手名
        # href="...toban=XXXX" を持つ a タグがある td を探す
        racer_id, grade, racer_name = "", "", ""
        for td in tbody.find_all("td", rowspan="4"):
            a_tag = td.find("a", href=re.compile(r"toban=\d+"))
            if a_tag and a_tag.get_text(strip=True):
                racer_name = a_tag.get_text(strip=True).replace("\u3000", " ").strip()
                m = re.search(r"toban=(\d+)", a_tag.get("href", ""))
                if m:
                    racer_id = m.group(1)
                raw = td.get_text(" ", strip=True)
                gm = re.search(r"\b(A1|A2|B1|B2)\b", raw)
                if gm:
                    grade = gm.group(1)
                break

        # F数・L数・平均ST（td.is-lineH2 の 1番目）
        lineh2_tds = tbody.select("td.is-lineH2[rowspan='4']")
        f_count, l_count = "0", "0"
        if lineh2_tds:
            fl_lines = lineh2_tds[0].get_text("\n", strip=True).split("\n")
            # 例: ["F0", "L0", "0.19"]
            for line in fl_lines:
                m = re.match(r"F(\d+)", line)
                if m:
                    f_count = m.group(1)
                m = re.match(r"L(\d+)", line)
                if m:
                    l_count = m.group(1)

        # 全国勝率（2番目）
        national_rate = ""
        if len(lineh2_tds) > 1:
            lines = lineh2_tds[1].get_text("\n", strip=True).split("\n")
            national_rate = lines[0] if lines else ""

        # 当地勝率（3番目）
        local_rate = ""
        if len(lineh2_tds) > 2:
            lines = lineh2_tds[2].get_text("\n", strip=True).split("\n")
            local_rate = lines[0] if lines else ""

        # モーター2連対率（4番目）
        motor_rate = ""
        if len(lineh2_tds) > 3:
            lines = lineh2_tds[3].get_text("\n", strip=True).split("\n")
            motor_rate = lines[1] if len(lines) > 1 else ""

        # 今節成績（is-fBold 行の着順リスト）
        recent_results = []
        result_row = tbody.find("tr", class_="is-fBold")
        if result_row:
            for td in result_row.find_all("td"):
                a = td.find("a")
                val = _text(a) if a else _text(td)
                if val and val != "\xa0":
                    recent_results.append(val)

        boats.append({
            "boat_no": boat_no,
            "racer_name": racer_name,
            "racer_id": racer_id,
            "grade": grade,
            "national_rate": national_rate,
            "local_rate": local_rate,
            "motor_rate": motor_rate,
            "f_count": f_count,
            "l_count": l_count,
            "recent_results": recent_results,
        })

    boats.sort(key=lambda x: x["boat_no"])

    # レース名（シリーズ名）
    race_name_tag = soup.select_one(".heading2_titleName")
    race_name = _text(race_name_tag) if race_name_tag else ""

    return {
        "stadium": STADIUM_MAP.get(jcd, jcd),
        "jcd": jcd,
        "race_date": date,
        "race_no": rno,
        "race_name": race_name,
        "boats": boats,
    }


def get_beforeinfo(jcd: str, date: str, rno: int) -> dict:
    """
    展示情報・気象を取得する。

    Returns
    -------
    dict:
        weather     : 天気
        temperature : 気温 (例 "12.0")
        wind_speed  : 風速 (例 "3")
        wind_dir    : 風向 (例 "東")
        water_temp  : 水温 (例 "10.0")
        wave_height : 波高 (例 "2")
        boats       : list[dict]
            - boat_no    : 艇番
            - exhibit_time : 展示タイム
            - tilt       : チルト
            - st_exhibit : ST展示（"F0.10" など）
    """
    url = (
        f"https://www.boatrace.jp/owpc/pc/race/beforeinfo"
        f"?jcd={jcd}&hd={date}&rno={rno}"
    )
    soup = _fetch(url)

    # ---- 展示タイム・チルト ----
    exhibit_map: dict[int, dict] = {}
    tbodies = soup.select("div.table1 table.is-w748 tbody")
    for tbody in tbodies:
        boat_td = tbody.select_one("td[class*='is-boatColor']")
        if boat_td is None:
            continue
        boat_no = int(re.sub(r"\D", "", _text(boat_td)) or 0)
        if boat_no == 0:
            continue

        # rowspan=4 の td を順番で取得
        row4_tds = tbody.select("td[rowspan='4']")
        exhibit_time, tilt = "", ""
        # 展示タイム=4番目(index3)、チルト=5番目(index4)
        # ※ 枠番・写真・選手名・体重を除いた位置
        # 実際は tbody の全 td[rowspan=4] の並び順で判断
        texts = [td.get_text(strip=True) for td in row4_tds]
        # texts例: ["1", "", "小林遼太", "52.4kg", "6.65", "-0.5", ...]
        # 数値っぽいものを展示タイム・チルトとして探す
        for t in texts:
            if re.match(r"^\d+\.\d{2}$", t) and not exhibit_time:
                exhibit_time = t
            elif re.match(r"^[+-]?\d+\.\d$", t) and not tilt:
                tilt = t

        exhibit_map[boat_no] = {
            "exhibit_time": exhibit_time,
            "tilt": tilt,
        }

    # ---- ST展示 ----
    st_map: dict[int, str] = {}
    for div in soup.select("div.table1_boatImage1"):
        num_span = div.select_one("span.table1_boatImage1Number")
        time_span = div.select_one("span.table1_boatImage1Time")
        if num_span is None or time_span is None:
            continue
        # 艇番: is-type{N} クラスの N
        m = re.search(r"is-type(\d+)", " ".join(num_span.get("class", [])))
        if not m:
            continue
        boat_no = int(m.group(1))
        st_raw = _text(time_span)  # 例: ".13" または "F.10"
        # Fフライングの場合は "F0.10" 形式に正規化
        if st_raw.startswith("F"):
            st_val = st_raw[1:].lstrip(".")
            st_exhibit = f"F0.{st_val}" if "." not in st_val else f"F{st_val}"
        else:
            # ".13" → "0.13"
            st_exhibit = f"0{st_raw}" if st_raw.startswith(".") else st_raw
        st_map[boat_no] = st_exhibit

    # ---- 気象 ----
    weather_div = soup.select_one("div.weather1")
    weather, temperature, wind_speed, wind_dir, water_temp, wave_height = (
        "", "", "", "", "", ""
    )
    if weather_div:
        # 天気
        w_unit = weather_div.select_one("div.weather1_bodyUnit.is-weather")
        if w_unit:
            weather = _text(w_unit.select_one(".weather1_bodyUnitLabelTitle"))

        # 気温
        d_unit = weather_div.select_one("div.weather1_bodyUnit.is-direction")
        if d_unit:
            temperature = _text(
                d_unit.select_one(".weather1_bodyUnitLabelData")
            ).replace("℃", "")

        # 風速
        wind_unit = weather_div.select_one("div.weather1_bodyUnit.is-wind")
        if wind_unit:
            wind_speed = _text(
                wind_unit.select_one(".weather1_bodyUnitLabelData")
            ).replace("m", "")

        # 風向
        wdir_unit = weather_div.select_one("div.weather1_bodyUnit.is-windDirection")
        if wdir_unit:
            img_tag = wdir_unit.select_one(".weather1_bodyUnitImage")
            if img_tag:
                m = re.search(r"is-wind(\d+)", " ".join(img_tag.get("class", [])))
                if m:
                    wind_dir = WIND_DIR_MAP.get(m.group(1), f"方向{m.group(1)}")

        # 水温
        wt_unit = weather_div.select_one("div.weather1_bodyUnit.is-waterTemperature")
        if wt_unit:
            water_temp = _text(
                wt_unit.select_one(".weather1_bodyUnitLabelData")
            ).replace("℃", "")

        # 波高
        wave_unit = weather_div.select_one("div.weather1_bodyUnit.is-wave")
        if wave_unit:
            wave_height = _text(
                wave_unit.select_one(".weather1_bodyUnitLabelData")
            ).replace("cm", "")

    # ---- 結合 ----
    boats = []
    for boat_no in range(1, 7):
        ex = exhibit_map.get(boat_no, {})
        boats.append({
            "boat_no": boat_no,
            "exhibit_time": ex.get("exhibit_time", ""),
            "tilt": ex.get("tilt", ""),
            "st_exhibit": st_map.get(boat_no, ""),
        })

    return {
        "weather": weather,
        "temperature": temperature,
        "wind_speed": wind_speed,
        "wind_dir": wind_dir,
        "water_temp": water_temp,
        "wave_height": wave_height,
        "boats": boats,
    }
