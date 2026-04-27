import requests
import time

SPARQL_URL = "https://query.wikidata.org/sparql"
HEADERS = {"User-Agent": "ThesisPrototype/1.0 (TU Chemnitz)"}

def q(query):
    for attempt in range(3):
        try:
            resp = requests.get(
                SPARQL_URL,
                params={"query": query, "format": "json"},
                headers=HEADERS,
                timeout=30
            )
            print(f"  Status: {resp.status_code}, Length: {len(resp.text)}")
            if resp.status_code == 429:
                print("  Rate limited, waiting 10s...")
                time.sleep(10)
                continue
            if not resp.text.strip():
                print("  Empty response, waiting 5s...")
                time.sleep(5)
                continue
            return resp.json()["results"]["bindings"]
        except Exception as e:
            print(f"  Error attempt {attempt+1}: {e}")
            time.sleep(3)
    return []

# Простой тест сначала
print("=== Simple test ===")
rows = q("SELECT ?item WHERE { wd:Q615 wdt:P54 ?item } LIMIT 5")
print(f"Got {len(rows)} rows")
for r in rows:
    print(r.get("item",{}).get("value",""))

# Messi с датами
print("\n=== Messi clubs with dates ===")
rows = q("""
SELECT ?club ?clubLabel ?start ?end WHERE {
  wd:Q615 p:P54 ?membership .
  ?membership ps:P54 ?club .
  OPTIONAL { ?membership pq:P580 ?start }
  OPTIONAL { ?membership pq:P582 ?end }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}
""")
for r in rows:
    print(
        r.get("clubLabel",{}).get("value","?"),
        r.get("start",{}).get("value","?")[:10] if r.get("start") else "?",
        "->",
        r.get("end",{}).get("value","?")[:10] if r.get("end") else "now"
    )