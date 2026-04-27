import requests
import sqlite3
import os
import time

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "changelog.db")
SPARQL_URL = "https://query.wikidata.org/sparql"
HEADERS = {"User-Agent": "ThesisPrototype/1.0 (TU Chemnitz)"}

def sparql_query(query):
    for attempt in range(3):
        try:
            resp = requests.get(
                SPARQL_URL,
                params={"query": query, "format": "json"},
                headers=HEADERS,
                timeout=60
            )
            if resp.status_code == 429:
                print("  Rate limited, waiting 15s...")
                time.sleep(15)
                continue
            if not resp.text.strip():
                time.sleep(5)
                continue
            return resp.json()["results"]["bindings"]
        except Exception as e:
            print(f"  Error: {e}, retrying...")
            time.sleep(3)
    return []

def fetch_club_memberships():
    print("Fetching club memberships (in batches)...")
    all_rows = []

    top_clubs = [
        "wd:Q8682",   # FC Barcelona
        "wd:Q9696",   # Real Madrid
        "wd:Q18918",  # Manchester United
        "wd:Q44638",  # Chelsea
        "wd:Q43310",  # Bayern Munich
        "wd:Q40347",  # Juventus
        "wd:Q19786",  # Liverpool
        "wd:Q83868",  # Arsenal
        "wd:Q30629",  # Manchester City
        "wd:Q11571",  # AC Milan
        "wd:Q5849",   # Inter Milan
        "wd:Q45543",  # Paris Saint-Germain
        "wd:Q43504",  # Borussia Dortmund
        "wd:Q47711",  # Atletico Madrid
        "wd:Q43944",  # Ajax
    ]

    for club in top_clubs:
        query = f"""
        SELECT ?player ?playerLabel ?club ?clubLabel ?start ?end WHERE {{
          {club} ^ps:P54 ?membership .
          ?membership pq:P580 ?start .
          BIND({club} AS ?club)
          ?player p:P54 ?membership .
          OPTIONAL {{ ?membership pq:P582 ?end }}
          SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en" }}
        }}
        LIMIT 300
        """
        rows = sparql_query(query)
        all_rows.extend(rows)
        print(f"  {club}: {len(rows)} rows")
        time.sleep(1)

    return all_rows

def fetch_national_teams():
    print("Fetching national team memberships...")
    query = """
    SELECT ?player ?playerLabel ?team ?teamLabel ?start ?end WHERE {
      ?player wdt:P106 wd:Q937857 .
      ?player p:P54 ?membership .
      ?membership ps:P54 ?team .
      ?team wdt:P31 wd:Q6979593 .
      OPTIONAL { ?membership pq:P580 ?start }
      OPTIONAL { ?membership pq:P582 ?end }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
    }
    LIMIT 2000
    """
    return sparql_query(query)

def fetch_player_attributes():
    print("Fetching player attributes...")
    query = """
    SELECT ?player ?playerLabel ?dob ?country ?countryLabel
           ?position ?positionLabel ?birthplace ?birthplaceLabel WHERE {
      ?player wdt:P106 wd:Q937857 .
      OPTIONAL { ?player wdt:P569 ?dob }
      OPTIONAL { ?player wdt:P27 ?country }
      OPTIONAL { ?player wdt:P413 ?position }
      OPTIONAL { ?player wdt:P19 ?birthplace }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
    }
    LIMIT 2000
    """
    return sparql_query(query)

def fetch_awards():
    print("Fetching awards...")
    query = """
    SELECT ?player ?playerLabel ?award ?awardLabel ?year WHERE {
      ?player wdt:P106 wd:Q937857 .
      ?player p:P166 ?stmt .
      ?stmt ps:P166 ?award .
      OPTIONAL { ?stmt pq:P585 ?year }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
    }
    LIMIT 2000
    """
    return sparql_query(query)

def fetch_goals():
    print("Fetching goals and caps...")
    query = """
    SELECT ?player ?playerLabel ?goals ?caps WHERE {
      ?player wdt:P106 wd:Q937857 .
      OPTIONAL { ?player wdt:P1351 ?goals }
      OPTIONAL { ?player wdt:P1352 ?caps }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
    }
    LIMIT 2000
    """
    return sparql_query(query)

def build_and_insert(memberships, national_teams, attributes, awards, goals_data):
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
    seen_players = set()
    seen_events = set()

    def add_change(ts, s_iri, s_label, p_iri, p_label, o_val, o_label, op, ct):
        key = (ts, s_iri, p_iri, o_val, op)
        if key in seen_events:
            return
        seen_events.add(key)
        changes.append((ts, s_iri, s_label, p_iri, p_label, o_val, o_label, op, ct))

    # ── 1. Club memberships ───────────────────────────────────────────
    for row in memberships:
        player_iri   = row["player"]["value"]
        player_label = row.get("playerLabel", {}).get("value", player_iri.split("/")[-1])
        club_iri     = row["club"]["value"]
        club_label   = row.get("clubLabel", {}).get("value", club_iri.split("/")[-1])
        start        = row.get("start", {}).get("value", "")
        end          = row.get("end", {}).get("value", "")

        if not start:
            continue

        ts_start = start[:10]

        if player_iri not in seen_players:
            seen_players.add(player_iri)
            add_change(ts_start, player_iri, player_label,
                "rdf:type", "instance of",
                "wd:Q937857", "association football player",
                "add", "entity_lifecycle")

        add_change(ts_start, player_iri, player_label,
            "wdt:P54", "member of sports team",
            club_iri, club_label, "add", "object_property")

        if end:
            add_change(end[:10], player_iri, player_label,
                "wdt:P54", "member of sports team",
                club_iri, club_label, "delete", "object_property")

    # ── 2. National teams ────────────────────────────────────────────
    for row in national_teams:
        player_iri   = row["player"]["value"]
        player_label = row.get("playerLabel", {}).get("value", player_iri.split("/")[-1])
        team_iri     = row["team"]["value"]
        team_label   = row.get("teamLabel", {}).get("value", team_iri.split("/")[-1])
        start        = row.get("start", {}).get("value", "")
        end          = row.get("end", {}).get("value", "")

        if not start:
            continue

        add_change(start[:10], player_iri, player_label,
            "wdt:P54", "member of national team",
            team_iri, team_label, "add", "object_property")

        if end:
            add_change(end[:10], player_iri, player_label,
                "wdt:P54", "member of national team",
                team_iri, team_label, "delete", "object_property")

    # ── 3. Player attributes ─────────────────────────────────────────
    for row in attributes:
        player_iri    = row["player"]["value"]
        player_label  = row.get("playerLabel", {}).get("value", player_iri.split("/")[-1])
        dob           = row.get("dob", {}).get("value", "")
        country_iri   = row.get("country", {}).get("value", "")
        country_label = row.get("countryLabel", {}).get("value", "")
        pos_iri       = row.get("position", {}).get("value", "")
        pos_label     = row.get("positionLabel", {}).get("value", "")
        bp_iri        = row.get("birthplace", {}).get("value", "")
        bp_label      = row.get("birthplaceLabel", {}).get("value", "")

        if not dob:
            continue

        ts = dob[:10]

        add_change(ts, player_iri, player_label,
            "wdt:P569", "date of birth",
            dob[:10], dob[:10], "add", "datatype_property")

        if country_iri:
            add_change(ts, player_iri, player_label,
                "wdt:P27", "country of citizenship",
                country_iri, country_label, "add", "object_property")

        if pos_iri:
            add_change(ts, player_iri, player_label,
                "wdt:P413", "position played on team",
                pos_iri, pos_label, "add", "object_property")

        if bp_iri:
            add_change(ts, player_iri, player_label,
                "wdt:P19", "place of birth",
                bp_iri, bp_label, "add", "object_property")

    # ── 4. Awards ────────────────────────────────────────────────────
    for row in awards:
        player_iri   = row["player"]["value"]
        player_label = row.get("playerLabel", {}).get("value", player_iri.split("/")[-1])
        award_iri    = row["award"]["value"]
        award_label  = row.get("awardLabel", {}).get("value", award_iri.split("/")[-1])
        year         = row.get("year", {}).get("value", "")

        if not year:
            continue

        add_change(year[:10], player_iri, player_label,
            "wdt:P166", "award received",
            award_iri, award_label, "add", "object_property")

    # ── 5. Goals and caps ────────────────────────────────────────────
    for row in goals_data:
        player_iri   = row["player"]["value"]
        player_label = row.get("playerLabel", {}).get("value", player_iri.split("/")[-1])
        goals        = row.get("goals", {}).get("value", "")
        caps         = row.get("caps", {}).get("value", "")

        if goals:
            add_change("2024-01-01", player_iri, player_label,
                "wdt:P1351", "number of goals",
                goals, f"{goals} goals", "add", "datatype_property")

        if caps:
            add_change("2024-01-01", player_iri, player_label,
                "wdt:P1352", "number of appearances",
                caps, f"{caps} caps", "add", "datatype_property")

    # ── Insert ────────────────────────────────────────────────────────
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
        "SELECT COUNT(DISTINCT subject_iri) FROM changes"
    ).fetchone()[0]

    for ct in ["object_property", "datatype_property", "entity_lifecycle"]:
        n = conn.execute(
            "SELECT COUNT(*) FROM changes WHERE change_type=?", (ct,)
        ).fetchone()[0]
        print(f"  {ct}: {n}")

    conn.close()
    print(f"\nTotal: {count} change events for {entities} entities")


if __name__ == "__main__":
    memberships    = fetch_club_memberships()
    print(f"  -> {len(memberships)} rows")

    national_teams = fetch_national_teams()
    print(f"  -> {len(national_teams)} rows")

    attributes     = fetch_player_attributes()
    print(f"  -> {len(attributes)} rows")

    awards         = fetch_awards()
    print(f"  -> {len(awards)} rows")

    goals_data     = fetch_goals()
    print(f"  -> {len(goals_data)} rows")

    build_and_insert(memberships, national_teams, attributes, awards, goals_data)
    print("Done!")