import sqlite3

conn = sqlite3.connect('data/changelog.db')

total = conn.execute(
    "SELECT COUNT(*) FROM changes WHERE subject_iri='http://www.wikidata.org/entity/Q615'"
).fetchone()[0]

unique = conn.execute(
    "SELECT COUNT(*) FROM (SELECT DISTINCT timestamp, predicate_iri, object_value, operation FROM changes WHERE subject_iri='http://www.wikidata.org/entity/Q615')"
).fetchone()[0]

print(f'Total: {total}, Unique: {unique}')

rows = conn.execute("""
    SELECT timestamp, predicate_iri, object_value, operation, COUNT(*) as cnt 
    FROM changes 
    WHERE subject_iri='http://www.wikidata.org/entity/Q615' 
    GROUP BY timestamp, predicate_iri, object_value, operation 
    HAVING cnt > 1 
    LIMIT 5
""").fetchall()

for r in rows:
    print(r)

conn.close()