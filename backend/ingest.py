import requests
import sqlite3
import os
import time
import random

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "changelog.db")
SPARQL_URL = "https://query.wikidata.org/sparql"
HEADERS = {"User-Agent": "ThesisPrototype/1.0 (TU Chemnitz)"}

# ── Топ NBA игроки — только самые известные ───────────────────────────────────
# Отобраны вручную: легенды + современные звёзды, у всех есть данные в Wikidata
PLAYERS = {
    # ── Абсолютные легенды ────────────────────────────────────────────
    "Q25369":   "Kobe Bryant",
    "Q36159":   "LeBron James",
    "Q25278":   "Dwight Howard",
    "Q131065":  "Michael Jordan",
    "Q193792":  "Magic Johnson",
    "Q205765":  "Larry Bird",
    "Q215539":  "Shaquille O'Neal",
    "Q213932":  "Charles Barkley",
    "Q214270":  "Patrick Ewing",
    "Q202904":  "Scottie Pippen",
    "Q204551":  "Dennis Rodman",
    "Q311462":  "Karl Malone",
    "Q213919":  "John Stockton",
    "Q202878":  "Hakeem Olajuwon",
    "Q202929":  "David Robinson",
    "Q311473":  "Clyde Drexler",
    "Q311474":  "Gary Payton",
    "Q202927":  "Alonzo Mourning",
    "Q311480":  "Reggie Miller",
    "Q311483":  "Mitch Richmond",
    # ── Переходная эпоха 2000-х ───────────────────────────────────────
    "Q36124":   "Dirk Nowitzki",
    "Q168183":  "Tim Duncan",
    "Q212418":  "Kevin Garnett",
    "Q202897":  "Allen Iverson",
    "Q202893":  "Steve Nash",
    "Q202882":  "Jason Kidd",
    "Q202921":  "Ray Allen",
    "Q202907":  "Paul Pierce",
    "Q202886":  "Vince Carter",
    "Q202901":  "Tracy McGrady",
    "Q311460":  "Yao Ming",
    "Q202916":  "Amar'e Stoudemire",
    "Q202920":  "Carmelo Anthony",
    "Q202915":  "Dwyane Wade",
    "Q311456":  "Chris Bosh",
    "Q311457":  "Chris Paul",
    "Q202896":  "Pau Gasol",
    "Q311459":  "Tony Parker",
    "Q311461":  "Manu Ginóbili",
    "Q311463":  "Chauncey Billups",
    # ── Современные звёзды ────────────────────────────────────────────
    "Q193776":  "Kevin Durant",
    "Q200873":  "Stephen Curry",
    "Q170572":  "James Harden",
    "Q214998":  "Russell Westbrook",
    "Q200874":  "Kyrie Irving",
    "Q200878":  "Anthony Davis",
    "Q200877":  "Kawhi Leonard",
    "Q200876":  "Paul George",
    "Q200875":  "Damian Lillard",
    "Q200872":  "John Wall",
    "Q311450":  "Blake Griffin",
    "Q311451":  "DeAndre Jordan",
    "Q311452":  "Draymond Green",
    "Q311453":  "Klay Thompson",
    "Q311454":  "Jimmy Butler",
    "Q311455":  "Kemba Walker",
    "Q614495":  "Giannis Antetokounmpo",
    "Q614497":  "Joel Embiid",
    "Q614499":  "Nikola Jokić",
    "Q614501":  "Luka Dončić",
    "Q614503":  "Trae Young",
    "Q614505":  "Jayson Tatum",
    "Q614507":  "Zion Williamson",
    "Q614509":  "Ja Morant",
    "Q614511":  "Devin Booker",
    "Q614513":  "Bam Adebayo",
    "Q614515":  "Donovan Mitchell",
    "Q614517":  "Karl-Anthony Towns",
    "Q614519":  "De'Aaron Fox",
    "Q614521":  "Tyrese Haliburton",
}

def sparql_query(query, retries=5):
    for attempt in range(retries):
        try:
            resp = requests.get(
                SPARQL_URL,
                params={"query": query, "format": "json"},
                headers=HEADERS,
                timeout=90
            )
            if resp.status_code == 429:
                wait = 30 + attempt * 15
                print(f"  Rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue
            if resp.status_code == 500:
                print(f"  Server error 500, waiting 10s...")
                time.sleep(10)
                continue
            if not resp.text.strip():
                time.sleep(5)
                continue
            return resp.json().get("results", {}).get("bindings", [])
        except requests.exceptions.Timeout:
            print(f"  Timeout on attempt {attempt+1}, retrying...")
            time.sleep(5 + attempt * 5)
        except Exception as e:
            print(f"  Error: {e}, retrying...")
            time.sleep(3 + attempt * 3)
    return []


def pause():
    time.sleep(2.5 + random.uniform(0.5, 1.5))


def fetch_full_team_history(player_iri):
    query = f"""
    SELECT ?team ?teamLabel ?start ?end WHERE {{
      wd:{player_iri} p:P54 ?stmt .
      ?stmt ps:P54 ?team .
      OPTIONAL {{ ?stmt pq:P580 ?start }}
      OPTIONAL {{ ?stmt pq:P582 ?end }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en" }}
    }}
    """
    rows = sparql_query(query)
    pause()
    return rows


def fetch_attributes(player_iri):
    query = f"""
    SELECT ?dob ?dod ?country ?countryLabel ?position ?positionLabel
           ?birthplace ?birthplaceLabel ?height WHERE {{
      OPTIONAL {{ wd:{player_iri} wdt:P569  ?dob }}
      OPTIONAL {{ wd:{player_iri} wdt:P570  ?dod }}
      OPTIONAL {{ wd:{player_iri} wdt:P27   ?country }}
      OPTIONAL {{ wd:{player_iri} wdt:P413  ?position }}
      OPTIONAL {{ wd:{player_iri} wdt:P19   ?birthplace }}
      OPTIONAL {{ wd:{player_iri} wdt:P2048 ?height }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en" }}
    }}
    LIMIT 1
    """
    rows = sparql_query(query)
    pause()
    return rows


def fetch_awards(player_iri):
    query = f"""
    SELECT ?award ?awardLabel ?year WHERE {{
      wd:{player_iri} p:P166 ?stmt .
      ?stmt ps:P166 ?award .
      OPTIONAL {{ ?stmt pq:P585 ?year }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en" }}
    }}
    """
    rows = sparql_query(query)
    pause()
    return rows


def fetch_jersey_numbers(player_iri):
    query = f"""
    SELECT ?jersey ?clubLabel ?start ?end WHERE {{
      wd:{player_iri} p:P1618 ?stmt .
      ?stmt ps:P1618 ?jersey .
      OPTIONAL {{ ?stmt pq:P54 ?club }}
      OPTIONAL {{ ?stmt pq:P580 ?start }}
      OPTIONAL {{ ?stmt pq:P582 ?end }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en" }}
    }}
    """
    rows = sparql_query(query)
    pause()
    return rows


def build_db(all_player_data):
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DROP TABLE IF EXISTS changes")
    conn.execute("""
        CREATE TABLE changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            subject_iri TEXT NOT NULL,
            subject_label TEXT,
            predicate_iri TEXT NOT NULL,
            predicate_label TEXT,
            object_value TEXT,
            object_label TEXT,
            operation TEXT NOT NULL,
            change_type TEXT NOT NULL
        )
    """)
    conn.execute("CREATE INDEX idx_subject_ts ON changes(subject_iri, timestamp)")

    changes = []
    seen_events = set()

    def add(ts, s_iri, s_label, p_iri, p_label, o_val, o_label, op, ct):
        if not ts or not o_val:
            return
        key = (ts, s_iri, p_iri, str(o_val), op)
        if key in seen_events:
            return
        seen_events.add(key)
        changes.append((ts, s_iri, s_label, p_iri, p_label,
                        str(o_val), o_label, op, ct))

    for player_iri, player_label, data in all_player_data:
        full_iri = f"http://www.wikidata.org/entity/{player_iri}"
        teams    = data.get("teams", [])
        attrs    = data.get("attributes", [])
        awards   = data.get("awards", [])
        jerseys  = data.get("jerseys", [])

        # ── Самая ранняя дата для entity_lifecycle ───────────────────
        first_ts = None
        for row in teams:
            s = row.get("start", {}).get("value", "")
            if s and (first_ts is None or s < first_ts):
                first_ts = s
        if attrs:
            dob = attrs[0].get("dob", {}).get("value", "")
            if dob and (first_ts is None or dob < first_ts):
                first_ts = dob

        if first_ts:
            add(first_ts[:10], full_iri, player_label,
                "rdf:type", "instance of",
                "wd:Q3665646", "basketball player",
                "add", "entity_lifecycle")

        # ── 1. История команд ────────────────────────────────────────
        for row in teams:
            team_iri   = row.get("team",      {}).get("value", "")
            team_label = row.get("teamLabel", {}).get("value",
                         team_iri.split("/")[-1])
            start = row.get("start", {}).get("value", "")
            end   = row.get("end",   {}).get("value", "")
            if not team_iri or not start:
                continue
            add(start[:10], full_iri, player_label,
                "wdt:P54", "member of sports team",
                team_iri, team_label, "add", "object_property")
            if end:
                add(end[:10], full_iri, player_label,
                    "wdt:P54", "member of sports team",
                    team_iri, team_label, "delete", "object_property")

        # ── 2. Атрибуты ──────────────────────────────────────────────
        for row in attrs:
            dob           = row.get("dob",             {}).get("value", "")
            dod           = row.get("dod",             {}).get("value", "")
            country_iri   = row.get("country",         {}).get("value", "")
            country_label = row.get("countryLabel",    {}).get("value", "")
            pos_iri       = row.get("position",        {}).get("value", "")
            pos_label     = row.get("positionLabel",   {}).get("value", "")
            bp_iri        = row.get("birthplace",      {}).get("value", "")
            bp_label      = row.get("birthplaceLabel", {}).get("value", "")
            height        = row.get("height",          {}).get("value", "")

            if dob:
                ts = dob[:10]
                add(ts, full_iri, player_label,
                    "wdt:P569", "date of birth",
                    dob[:10], dob[:10], "add", "datatype_property")
                if country_iri:
                    add(ts, full_iri, player_label,
                        "wdt:P27", "country of citizenship",
                        country_iri, country_label, "add", "object_property")
                if pos_iri:
                    add(ts, full_iri, player_label,
                        "wdt:P413", "position played on team",
                        pos_iri, pos_label, "add", "object_property")
                if bp_iri:
                    add(ts, full_iri, player_label,
                        "wdt:P19", "place of birth",
                        bp_iri, bp_label, "add", "object_property")
                if height:
                    add(ts, full_iri, player_label,
                        "wdt:P2048", "height",
                        height, f"{height} m", "add", "datatype_property")
            if dod:
                add(dod[:10], full_iri, player_label,
                    "rdf:type", "instance of",
                    "wd:Q3665646", "basketball player",
                    "delete", "entity_lifecycle")

        # ── 3. Награды ───────────────────────────────────────────────
        for row in awards:
            award_iri   = row.get("award",      {}).get("value", "")
            award_label = row.get("awardLabel", {}).get("value",
                          award_iri.split("/")[-1])
            year = row.get("year", {}).get("value", "")
            if not year or not award_iri:
                continue
            add(year[:10], full_iri, player_label,
                "wdt:P166", "award received",
                award_iri, award_label, "add", "object_property")

        # ── 4. Номера на майке ───────────────────────────────────────
        for row in jerseys:
            jersey     = row.get("jersey",    {}).get("value", "")
            club_label = row.get("clubLabel", {}).get("value", "")
            start = row.get("start", {}).get("value", "")
            end   = row.get("end",   {}).get("value", "")
            if not jersey:
                continue
            ts = start[:10] if start else (first_ts[:10] if first_ts else None)
            if not ts:
                continue
            label = f"#{jersey}" + (f" at {club_label}" if club_label else "")
            add(ts, full_iri, player_label,
                "wdt:P1618", "shirt number",
                jersey, label, "add", "datatype_property")
            if end:
                add(end[:10], full_iri, player_label,
                    "wdt:P1618", "shirt number",
                    jersey, label, "delete", "datatype_property")

    conn.executemany("""
        INSERT INTO changes
          (timestamp, subject_iri, subject_label,
           predicate_iri, predicate_label,
           object_value, object_label,
           operation, change_type)
        VALUES (?,?,?,?,?,?,?,?,?)
    """, changes)
    conn.commit()

    count    = conn.execute("SELECT COUNT(*) FROM changes").fetchone()[0]
    entities = conn.execute(
        "SELECT COUNT(DISTINCT subject_iri) FROM changes").fetchone()[0]
    print(f"\n{'─'*50}")
    print(f"Total: {count} change events for {entities} entities")
    for ct in ["object_property", "datatype_property", "entity_lifecycle"]:
        n = conn.execute(
            "SELECT COUNT(*) FROM changes WHERE change_type=?",
            (ct,)).fetchone()[0]
        print(f"  {ct}: {n}")
    conn.close()


if __name__ == "__main__":
    print(f"Fetching data for {len(PLAYERS)} NBA players...\n")
    all_player_data = []
    total = len(PLAYERS)

    for i, (player_iri, player_label) in enumerate(PLAYERS.items(), 1):
        print(f"[{i}/{total}] {player_label} ({player_iri})")
        data = {
            "teams":      fetch_full_team_history(player_iri),
            "attributes": fetch_attributes(player_iri),
            "awards":     fetch_awards(player_iri),
            "jerseys":    fetch_jersey_numbers(player_iri),
        }
        print(f"  teams:{len(data['teams'])} attrs:{len(data['attributes'])} "
              f"awards:{len(data['awards'])} jerseys:{len(data['jerseys'])}")
        all_player_data.append((player_iri, player_label, data))
        time.sleep(3 + random.uniform(0, 2))

    print("\nBuilding database...")
    build_db(all_player_data)
    print("\nDone!")