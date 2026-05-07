"""
ingest.py — Knowledge Graph Evolution Dataset Builder
======================================================
Extended version with TWO temporal layers:

  Layer 1 – EVENT TIME   : when did the real-world event happen?
                           (from SPARQL: P569, P580, P582, P585 …)
  Layer 2 – KNOWLEDGE TIME: when did the community add/edit/remove
                           the fact in Wikidata?
                           (from MediaWiki revision history API)

This distinction is central to KG temporal dynamics research:
  Erxleben et al. 2014, Leblay & Chekol 2018, Lacroix et al. 2020

DB schema gains:
  - event_time       : real-world timestamp (may be NULL or year-precision)
  - knowledge_time   : exact datetime of the Wikidata edit
  - time_precision   : 9=year / 10=month / 11=day  (for event_time)
  - revision_id      : MediaWiki revision ID (traceable)
  - editor_type      : 'human' | 'bot'  (bots vs humans editing pattern)
"""

import os, re, time, sqlite3, random, logging, requests, json
from datetime import datetime, timezone
from typing import Optional

# ── Configuration ─────────────────────────────────────────────────────────────

DB_PATH      = os.path.join(os.path.dirname(__file__), "data", "changelog.db")
SPARQL_URL   = "https://query.wikidata.org/sparql"
MW_API_URL   = "https://www.wikidata.org/w/api.php"

HEADERS_SPARQL = {
    "User-Agent":      "ThesisPrototype/2.0 (TU Chemnitz; kg-evolution-thesis)",
    "Accept":          "application/sparql-results+json",
    "Accept-Encoding": "gzip",
}
HEADERS_MW = {
    "User-Agent": "ThesisPrototype/2.0 (TU Chemnitz; kg-evolution-thesis)",
}

SPORT_ITEM   = "Q3665646"   # basketball player
PLAYER_LIMIT = 120
BATCH_SIZE   = 60

# How many MediaWiki revisions to fetch per entity (keep ≤ 500 for speed)
# Set to 0 to skip revision history entirely (faster, event-time only)
REVISION_LIMIT = 500

# Known Wikidata bot account name patterns (extend as needed)
BOT_PATTERNS = re.compile(
    r"(bot|Bot|BOT|import|Import|wikidata-bot|QuickStatements)", re.I
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════════
# SPARQL helpers
# ══════════════════════════════════════════════════════════════════════════════

def sparql(query: str, retries: int = 6) -> list[dict]:
    for attempt in range(retries):
        try:
            resp = requests.get(
                SPARQL_URL,
                params={"query": query, "format": "json"},
                headers=HEADERS_SPARQL,
                timeout=120,
            )
            if resp.status_code == 429:
                wait = 30 * (attempt + 1)
                log.warning("Rate-limited — waiting %ds", wait)
                time.sleep(wait); continue
            if resp.status_code in (500, 503, 504):
                wait = 10 * (attempt + 1)
                log.warning("Server error %d — waiting %ds", resp.status_code, wait)
                time.sleep(wait); continue
            resp.raise_for_status()
            text = resp.text.strip()
            if not text:
                time.sleep(5); continue
            return resp.json().get("results", {}).get("bindings", [])
        except requests.exceptions.Timeout:
            wait = 10 + attempt * 10
            log.warning("Timeout attempt %d — waiting %ds", attempt + 1, wait)
            time.sleep(wait)
        except Exception as exc:
            log.error("Unexpected error: %s", exc)
            time.sleep(5 + attempt * 5)
    log.error("All %d retries exhausted", retries)
    return []


def polite_pause():
    time.sleep(1.5 + random.uniform(0.3, 0.7))


# ══════════════════════════════════════════════════════════════════════════════
# Temporal helpers
# ══════════════════════════════════════════════════════════════════════════════

def parse_wikidata_time(value: str, precision: Optional[int] = None) -> dict:
    """
    Parse a Wikidata time value into a normalised dict.

    Wikidata precision codes:
      9  = year only     → stored as YYYY-01-01, precision=9
      10 = year+month    → stored as YYYY-MM-01, precision=10
      11 = full date     → stored as YYYY-MM-DD, precision=11

    Returns {"ts": "YYYY-MM-DD", "precision": int}
    """
    if not value:
        return {"ts": None, "precision": None}

    # Strip leading '+' or '-' and trailing timezone
    raw = value.lstrip("+-").split("T")[0]   # "2010-01-01"

    # Detect year-only from value itself (Wikidata returns "2010-00-00")
    parts = raw.split("-")
    if len(parts) == 3:
        y, m, d = parts
        if m == "00":
            precision = precision or 9
            return {"ts": f"{y}-01-01", "precision": precision or 9}
        if d == "00":
            precision = precision or 10
            return {"ts": f"{y}-{m}-01", "precision": precision or 10}
    ts = raw[:10] if len(raw) >= 10 else raw
    return {"ts": ts, "precision": precision or 11}


def is_year_only(ts: str) -> bool:
    """True when we only have year precision (day+month = 01-01)."""
    return ts is not None and ts[5:] == "01-01"


# ══════════════════════════════════════════════════════════════════════════════
# LAYER 2 — MediaWiki Revision History
# ══════════════════════════════════════════════════════════════════════════════

def fetch_revisions(qid: str, limit: int = REVISION_LIMIT) -> list[dict]:
    """
    Fetch up to `limit` revisions for a Wikidata entity via the MediaWiki API.
    Returns list of dicts with keys: revision_id, knowledge_time, editor, editor_type, comment, diff_size
    """
    if limit == 0:
        return []

    revisions = []
    params = {
        "action":  "query",
        "titles":  qid,
        "prop":    "revisions",
        "rvprop":  "ids|timestamp|user|comment|size",
        "rvlimit": min(limit, 500),
        "format":  "json",
    }

    fetched = 0
    rvcontinue = None

    while fetched < limit:
        if rvcontinue:
            params["rvcontinue"] = rvcontinue

        try:
            resp = requests.get(MW_API_URL, params=params,
                                headers=HEADERS_MW, timeout=60)
            if resp.status_code == 429:
                time.sleep(20); continue
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            log.warning("Revision fetch error for %s: %s", qid, exc)
            break

        pages = data.get("query", {}).get("pages", {})
        for page in pages.values():
            for rev in page.get("revisions", []):
                editor  = rev.get("user", "")
                comment = rev.get("comment", "")
                revisions.append({
                    "revision_id":    rev.get("revid"),
                    "knowledge_time": rev.get("timestamp", "")[:19].replace("T", " "),
                    "editor":         editor,
                    "editor_type":    "bot" if BOT_PATTERNS.search(editor) else "human",
                    "comment":        comment[:200],
                    "size":           rev.get("size", 0),
                })
                fetched += 1

        cont = data.get("continue", {})
        rvcontinue = cont.get("rvcontinue")
        if not rvcontinue or fetched >= limit:
            break

        time.sleep(0.5)   # be polite to MediaWiki

    return revisions


def match_revision_to_event(
    revisions: list[dict],
    event_ts: Optional[str],
    predicate: str,
    operation: str,
) -> Optional[dict]:
    """
    Heuristic: find the MediaWiki revision most likely responsible for
    adding/deleting a specific fact.

    Strategy:
      - If event_ts is available: find the earliest revision AFTER event_ts
        whose comment mentions the predicate property ID.
      - Fallback: first revision after event_ts regardless of comment.
      - If event_ts is None: return None (can't anchor).

    This is intentionally conservative — for a thesis you want defensible
    matching, not magic.
    """
    if not revisions or not event_ts:
        return None

    # Extract property ID from predicate string e.g. "wdt:P54" → "P54"
    prop_id = predicate.split(":")[-1] if ":" in predicate else predicate

    # Sort revisions ascending by knowledge_time
    sorted_revs = sorted(revisions, key=lambda r: r["knowledge_time"])

    # Try to find revision after the event with matching comment
    for rev in sorted_revs:
        if rev["knowledge_time"][:10] >= event_ts[:10]:
            if prop_id.lower() in rev["comment"].lower():
                return rev

    # Fallback: first revision after event_ts
    for rev in sorted_revs:
        if rev["knowledge_time"][:10] >= event_ts[:10]:
            return rev

    return None


# ══════════════════════════════════════════════════════════════════════════════
# Step 1: Discover players
# ══════════════════════════════════════════════════════════════════════════════

def discover_players(sport_item: str, limit: int) -> dict[str, str]:
    """
    Return {qid: label} for `limit` players.
    No mandatory P54 filter — many players lack team statements.
    """
    log.info("Discovering %d players for wd:%s …", limit, sport_item)

    query = f"""
    SELECT DISTINCT ?player WHERE {{
      ?player wdt:P106 wd:{sport_item} .
    }}
    LIMIT {limit}
    """
    rows = sparql(query)
    polite_pause()

    if not rows:
        return {}

    qids = [r["player"]["value"].rsplit("/", 1)[-1] for r in rows]

    # Fetch labels in batches
    players = {}
    for i in range(0, len(qids), 60):
        chunk = qids[i:i+60]
        values = "VALUES ?player { " + " ".join(f"wd:{q}" for q in chunk) + " }"
        label_query = f"""
        SELECT ?player ?playerLabel WHERE {{
          {values}
          SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en" }}
        }}
        """
        for row in sparql(label_query):
            qid   = row["player"]["value"].rsplit("/", 1)[-1]
            label = row.get("playerLabel", {}).get("value", qid)
            players[qid] = label
        polite_pause()

    log.info("Discovered %d players", len(players))
    return players


# ══════════════════════════════════════════════════════════════════════════════
# Step 2: Batched SPARQL fetchers  (same as before, added precision fetch)
# ══════════════════════════════════════════════════════════════════════════════

def _values_clause(qids: list[str]) -> str:
    return "VALUES ?player { " + " ".join(f"wd:{q}" for q in qids) + " }"


def fetch_teams_batch(qids: list[str]) -> list[dict]:
    values = _values_clause(qids)
    query = f"""
    SELECT ?player ?team ?teamLabel ?start ?end WHERE {{
      {values}
      ?player p:P54 ?stmt .
      ?stmt ps:P54 ?team .
      OPTIONAL {{ ?stmt pq:P580 ?start }}
      OPTIONAL {{ ?stmt pq:P582 ?end }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en" }}
    }}
    """
    rows = sparql(query); polite_pause(); return rows


def fetch_attributes_batch(qids: list[str]) -> list[dict]:
    values = _values_clause(qids)
    query = f"""
    SELECT ?player
           ?dob ?dod
           ?country ?countryLabel
           ?position ?positionLabel
           ?birthplace ?birthplaceLabel
           ?height WHERE {{
      {values}
      OPTIONAL {{ ?player wdt:P569  ?dob }}
      OPTIONAL {{ ?player wdt:P570  ?dod }}
      OPTIONAL {{ ?player wdt:P27   ?country }}
      OPTIONAL {{ ?player wdt:P413  ?position }}
      OPTIONAL {{ ?player wdt:P19   ?birthplace }}
      OPTIONAL {{ ?player wdt:P2048 ?height }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en" }}
    }}
    """
    rows = sparql(query); polite_pause(); return rows


def fetch_awards_batch(qids: list[str]) -> list[dict]:
    """
    Fetch awards with YEAR() extraction to handle year-precision timestamps.
    Returns yearStr as "YYYY" instead of "YYYY-01-01T00:00:00Z".
    """
    values = _values_clause(qids)
    query = f"""
    SELECT ?player ?award ?awardLabel
           (STR(YEAR(?year)) AS ?yearStr) WHERE {{
      {values}
      ?player p:P166 ?stmt .
      ?stmt ps:P166 ?award .
      OPTIONAL {{ ?stmt pq:P585 ?year }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en" }}
    }}
    """
    rows = sparql(query); polite_pause(); return rows


def fetch_jerseys_batch(qids: list[str]) -> list[dict]:
    values = _values_clause(qids)
    query = f"""
    SELECT ?player ?jersey ?clubLabel ?start ?end WHERE {{
      {values}
      ?player p:P1618 ?stmt .
      ?stmt ps:P1618 ?jersey .
      OPTIONAL {{ ?stmt pq:P54 ?club }}
      OPTIONAL {{ ?stmt pq:P580 ?start }}
      OPTIONAL {{ ?stmt pq:P582 ?end }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en" }}
    }}
    """
    rows = sparql(query); polite_pause(); return rows


# ══════════════════════════════════════════════════════════════════════════════
# Step 3: Collect all data in batches
# ══════════════════════════════════════════════════════════════════════════════

def collect_all(players: dict[str, str]) -> dict[str, dict]:
    qids    = list(players.keys())
    buckets = {q: {"teams": [], "attributes": [], "awards": [], "jerseys": []}
               for q in qids}

    total_batches = (len(qids) + BATCH_SIZE - 1) // BATCH_SIZE

    for batch_idx, start in enumerate(range(0, len(qids), BATCH_SIZE)):
        chunk = qids[start : start + BATCH_SIZE]
        log.info("Batch %d/%d — %d players", batch_idx + 1, total_batches, len(chunk))

        def route(rows, key):
            for row in rows:
                qid = row.get("player", {}).get("value", "").rsplit("/", 1)[-1]
                if qid in buckets:
                    buckets[qid][key].append(row)

        route(fetch_teams_batch(chunk),      "teams")
        route(fetch_attributes_batch(chunk), "attributes")
        route(fetch_awards_batch(chunk),     "awards")
        route(fetch_jerseys_batch(chunk),    "jerseys")

    empty = sum(1 for v in buckets.values()
                if not v["teams"] and not v["attributes"])
    log.info("Coverage: %d/%d players have data (%d empty)",
             len(qids) - empty, len(qids), empty)
    return buckets


# ══════════════════════════════════════════════════════════════════════════════
# Step 4: Fetch revision histories
# ══════════════════════════════════════════════════════════════════════════════

def collect_revisions(qids: list[str]) -> dict[str, list[dict]]:
    """
    Fetch MediaWiki revision history for all players.
    Returns {qid: [revision_dicts]}.
    """
    if REVISION_LIMIT == 0:
        log.info("Revision history disabled (REVISION_LIMIT=0)")
        return {q: [] for q in qids}

    log.info("Fetching revision history for %d players …", len(qids))
    result = {}
    for i, qid in enumerate(qids):
        if i % 20 == 0:
            log.info("  Revisions: %d/%d", i, len(qids))
        result[qid] = fetch_revisions(qid, REVISION_LIMIT)
        time.sleep(0.8)   # polite to MediaWiki

    total_revs = sum(len(v) for v in result.values())
    log.info("Fetched %d total revisions across %d entities", total_revs, len(qids))
    return result


# ══════════════════════════════════════════════════════════════════════════════
# Step 5: Build SQLite changelog — now with two temporal layers
# ══════════════════════════════════════════════════════════════════════════════

def build_db(
    players:   dict[str, str],
    buckets:   dict[str, dict],
    revisions: dict[str, list[dict]],
) -> None:

    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)

    conn.executescript("""
        DROP TABLE IF EXISTS changes;
        DROP TABLE IF EXISTS revisions;

        -- ── Main change log ──────────────────────────────────────────
        CREATE TABLE changes (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,

            -- Layer 1: EVENT TIME (when did it happen in the real world?)
            event_time       TEXT,        -- YYYY-MM-DD or NULL
            time_precision   INTEGER,     -- 9=year / 10=month / 11=day

            -- Layer 2: KNOWLEDGE TIME (when did Wikidata learn about it?)
            knowledge_time   TEXT,        -- YYYY-MM-DD HH:MM:SS or NULL
            revision_id      INTEGER,     -- MediaWiki revision ID
            editor_type      TEXT,        -- 'human' | 'bot' | NULL

            -- What changed
            subject_iri      TEXT  NOT NULL,
            subject_label    TEXT,
            predicate_iri    TEXT  NOT NULL,
            predicate_label  TEXT,
            object_value     TEXT,
            object_label     TEXT,
            operation        TEXT  NOT NULL,   -- 'add' | 'delete' | 'update'
            change_type      TEXT  NOT NULL    -- 'object_property' | 'datatype_property' | 'entity_lifecycle'
        );

        CREATE INDEX idx_subject_et  ON changes(subject_iri, event_time);
        CREATE INDEX idx_subject_kt  ON changes(subject_iri, knowledge_time);
        CREATE INDEX idx_event_time  ON changes(event_time);
        CREATE INDEX idx_know_time   ON changes(knowledge_time);
        CREATE INDEX idx_change_type ON changes(change_type);
        CREATE INDEX idx_editor_type ON changes(editor_type);
        CREATE INDEX idx_precision   ON changes(time_precision);

        -- ── Raw revision log (for deeper analysis) ───────────────────
        CREATE TABLE revisions (
            revision_id    INTEGER PRIMARY KEY,
            entity_qid     TEXT    NOT NULL,
            entity_label   TEXT,
            knowledge_time TEXT    NOT NULL,
            editor         TEXT,
            editor_type    TEXT,
            comment        TEXT,
            size           INTEGER
        );
        CREATE INDEX idx_rev_entity ON revisions(entity_qid);
        CREATE INDEX idx_rev_time   ON revisions(knowledge_time);
        CREATE INDEX idx_rev_editor ON revisions(editor_type);
    """)

    changes     = []
    seen_events = set()

    def add(event_ts, precision, know_ts, rev_id, ed_type,
            s_iri, s_label, p_iri, p_label, o_val, o_label, op, ct):
        if not o_val:
            return
        # Normalise event_time
        et = event_ts[:10] if event_ts else None
        if et and not re.match(r"\d{4}-\d{2}-\d{2}", et):
            return
        key = (et, s_iri, p_iri, str(o_val), op)
        if key in seen_events:
            return
        seen_events.add(key)
        changes.append((
            et, precision, know_ts, rev_id, ed_type,
            s_iri, s_label, p_iri, p_label,
            str(o_val), o_label, op, ct
        ))

    for qid, player_label in players.items():
        data     = buckets.get(qid, {})
        revs     = revisions.get(qid, [])
        full_iri = f"http://www.wikidata.org/entity/{qid}"

        teams   = data.get("teams",      [])
        attrs   = data.get("attributes", [])
        awards  = data.get("awards",     [])
        jerseys = data.get("jerseys",    [])

        # ── Entity lifecycle ──────────────────────────────────────────
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
            pt = parse_wikidata_time(first_ts)
            rev = match_revision_to_event(revs, pt["ts"], "P106", "add")
            add(pt["ts"], pt["precision"],
                rev["knowledge_time"] if rev else None,
                rev["revision_id"]    if rev else None,
                rev["editor_type"]    if rev else None,
                full_iri, player_label,
                "wdt:P106", "occupation",
                f"wd:{SPORT_ITEM}", "basketball player",
                "add", "entity_lifecycle")

        # ── Team history ──────────────────────────────────────────────
        for row in teams:
            team_iri   = row.get("team",      {}).get("value", "")
            team_label = row.get("teamLabel", {}).get("value",
                         team_iri.rsplit("/", 1)[-1] if team_iri else "")
            start_raw  = row.get("start", {}).get("value", "")
            end_raw    = row.get("end",   {}).get("value", "")

            if not team_iri or not start_raw:
                continue

            pt_start = parse_wikidata_time(start_raw)
            rev_add  = match_revision_to_event(revs, pt_start["ts"], "P54", "add")
            add(pt_start["ts"], pt_start["precision"],
                rev_add["knowledge_time"] if rev_add else None,
                rev_add["revision_id"]    if rev_add else None,
                rev_add["editor_type"]    if rev_add else None,
                full_iri, player_label,
                "wdt:P54", "member of sports team",
                team_iri, team_label, "add", "object_property")

            if end_raw:
                pt_end  = parse_wikidata_time(end_raw)
                rev_del = match_revision_to_event(revs, pt_end["ts"], "P54", "delete")
                add(pt_end["ts"], pt_end["precision"],
                    rev_del["knowledge_time"] if rev_del else None,
                    rev_del["revision_id"]    if rev_del else None,
                    rev_del["editor_type"]    if rev_del else None,
                    full_iri, player_label,
                    "wdt:P54", "member of sports team",
                    team_iri, team_label, "delete", "object_property")

        # ── Attributes ────────────────────────────────────────────────
        seen_preds: set[str] = set()
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

            ts_raw = dob if dob else first_ts
            if not ts_raw:
                continue
            pt_base = parse_wikidata_time(ts_raw)

            def attr_add(pred_key, p_iri, p_label, o_val, o_label, precision=None):
                if not o_val or pred_key in seen_preds:
                    return
                seen_preds.add(pred_key)
                pt = parse_wikidata_time(ts_raw) if not precision else \
                     {"ts": pt_base["ts"], "precision": precision}
                rev = match_revision_to_event(revs, pt["ts"], p_iri.split(":")[-1], "add")
                add(pt["ts"], pt["precision"],
                    rev["knowledge_time"] if rev else None,
                    rev["revision_id"]    if rev else None,
                    rev["editor_type"]    if rev else None,
                    full_iri, player_label,
                    p_iri, p_label, o_val, o_label, "add",
                    "datatype_property" if "P569" in p_iri or "P2048" in p_iri
                    else "object_property")

            if dob:
                attr_add("dob",    "wdt:P569", "date of birth",
                         dob[:10], dob[:10], precision=11)
            if country_iri:
                attr_add(country_iri, "wdt:P27", "country of citizenship",
                         country_iri, country_label)
            if pos_iri:
                attr_add(pos_iri, "wdt:P413", "position played on team",
                         pos_iri, pos_label)
            if bp_iri:
                attr_add(bp_iri, "wdt:P19", "place of birth",
                         bp_iri, bp_label)
            if height:
                attr_add("height", "wdt:P2048", "height",
                         height, f"{height} m")

            if dod:
                pt_dod = parse_wikidata_time(dod)
                rev = match_revision_to_event(revs, pt_dod["ts"], "P106", "delete")
                add(pt_dod["ts"], pt_dod["precision"],
                    rev["knowledge_time"] if rev else None,
                    rev["revision_id"]    if rev else None,
                    rev["editor_type"]    if rev else None,
                    full_iri, player_label,
                    "wdt:P106", "occupation",
                    f"wd:{SPORT_ITEM}", "basketball player",
                    "delete", "entity_lifecycle")

        # ── Awards  (year-precision handled via YEAR() in SPARQL) ─────
        for row in awards:
            award_iri   = row.get("award",      {}).get("value", "")
            award_label = row.get("awardLabel", {}).get("value",
                          award_iri.rsplit("/", 1)[-1] if award_iri else "")
            year_str    = row.get("yearStr", {}).get("value", "")

            if not year_str or not award_iri:
                continue

            # Year-only → precision 9, stored as YYYY-01-01
            event_ts = year_str + "-01-01"
            rev = match_revision_to_event(revs, event_ts, "P166", "add")
            add(event_ts, 9,   # precision=9 means year only
                rev["knowledge_time"] if rev else None,
                rev["revision_id"]    if rev else None,
                rev["editor_type"]    if rev else None,
                full_iri, player_label,
                "wdt:P166", "award received",
                award_iri, award_label, "add", "object_property")

        # ── Jersey numbers ────────────────────────────────────────────
        for row in jerseys:
            jersey     = row.get("jersey",    {}).get("value", "")
            club_label = row.get("clubLabel", {}).get("value", "")
            start_raw  = row.get("start", {}).get("value", "")
            end_raw    = row.get("end",   {}).get("value", "")

            if not jersey:
                continue
            ts_raw = start_raw or first_ts
            if not ts_raw:
                continue

            pt    = parse_wikidata_time(ts_raw)
            label = f"#{jersey}" + (f" at {club_label}" if club_label else "")
            rev   = match_revision_to_event(revs, pt["ts"], "P1618", "add")
            add(pt["ts"], pt["precision"],
                rev["knowledge_time"] if rev else None,
                rev["revision_id"]    if rev else None,
                rev["editor_type"]    if rev else None,
                full_iri, player_label,
                "wdt:P1618", "shirt number",
                jersey, label, "add", "datatype_property")

            if end_raw:
                pt_e  = parse_wikidata_time(end_raw)
                rev_d = match_revision_to_event(revs, pt_e["ts"], "P1618", "delete")
                add(pt_e["ts"], pt_e["precision"],
                    rev_d["knowledge_time"] if rev_d else None,
                    rev_d["revision_id"]    if rev_d else None,
                    rev_d["editor_type"]    if rev_d else None,
                    full_iri, player_label,
                    "wdt:P1618", "shirt number",
                    jersey, label, "delete", "datatype_property")

    # ── Write changes ─────────────────────────────────────────────────
    conn.executemany("""
        INSERT INTO changes (
            event_time, time_precision, knowledge_time, revision_id, editor_type,
            subject_iri, subject_label, predicate_iri, predicate_label,
            object_value, object_label, operation, change_type
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, changes)

    # ── Write raw revisions ───────────────────────────────────────────
    rev_rows = []
    for qid, revs in revisions.items():
        label = players.get(qid, qid)
        for rev in revs:
            rev_rows.append((
                rev["revision_id"], qid, label,
                rev["knowledge_time"], rev["editor"],
                rev["editor_type"], rev["comment"], rev["size"]
            ))

    conn.executemany("""
        INSERT OR IGNORE INTO revisions (
            revision_id, entity_qid, entity_label,
            knowledge_time, editor, editor_type, comment, size
        ) VALUES (?,?,?,?,?,?,?,?)
    """, rev_rows)

    conn.commit()

    # ── Stats ─────────────────────────────────────────────────────────
    total    = conn.execute("SELECT COUNT(*) FROM changes").fetchone()[0]
    entities = conn.execute(
        "SELECT COUNT(DISTINCT subject_iri) FROM changes").fetchone()[0]
    with_kt  = conn.execute(
        "SELECT COUNT(*) FROM changes WHERE knowledge_time IS NOT NULL").fetchone()[0]
    total_revisions = conn.execute("SELECT COUNT(*) FROM revisions").fetchone()[0]
    bot_revs = conn.execute(
        "SELECT COUNT(*) FROM revisions WHERE editor_type='bot'").fetchone()[0]

    print(f"\n{'═'*60}")
    print(f"  Change events : {total}  ({entities} entities)")
    print(f"  With knowledge_time: {with_kt} ({100*with_kt//total if total else 0}%)")
    print(f"  Raw revisions : {total_revisions}  (bots: {bot_revs})")
    print(f"{'─'*60}")
    for ct in ["object_property", "datatype_property", "entity_lifecycle"]:
        n = conn.execute(
            "SELECT COUNT(*) FROM changes WHERE change_type=?", (ct,)
        ).fetchone()[0]
        print(f"  {ct:30s}: {n:>6}")
    print(f"{'─'*60}")
    for prec, label in [(9, "year-only"), (10, "month"), (11, "full date"), (None, "unknown")]:
        n = conn.execute(
            "SELECT COUNT(*) FROM changes WHERE time_precision IS ?", (prec,)
        ).fetchone()[0]
        print(f"  precision {str(prec):4s} ({label:10s})  : {n:>6}")
    print(f"{'─'*60}")
    print(f"  DB: {DB_PATH}")
    print(f"{'═'*60}\n")
    conn.close()


# ══════════════════════════════════════════════════════════════════════════════
# Entry point
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    t0 = time.time()
    print(f"\n{'═'*60}")
    print(f"  KG Evolution Ingestion v2  —  {datetime.now():%Y-%m-%d %H:%M}")
    print(f"  Sport item    : wd:{SPORT_ITEM}")
    print(f"  Player limit  : {PLAYER_LIMIT}")
    print(f"  Batch size    : {BATCH_SIZE}")
    print(f"  Rev. limit    : {REVISION_LIMIT} per entity")
    print(f"{'═'*60}\n")

    players = discover_players(SPORT_ITEM, PLAYER_LIMIT)
    if not players:
        log.error("No players found — check SPORT_ITEM or network.")
        raise SystemExit(1)

    buckets   = collect_all(players)
    revisions = collect_revisions(list(players.keys()))

    log.info("Writing database …")
    build_db(players, buckets, revisions)

    elapsed = time.time() - t0
    print(f"  Done in {elapsed:.0f}s  ({elapsed/60:.1f} min)\n")