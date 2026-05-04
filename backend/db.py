import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "changelog.db")

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS changes (
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
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_subject_ts
        ON changes(subject_iri, timestamp)
    """)
    conn.commit()
    conn.close()

def get_all_entities(search: str = None):
    conn = get_connection()
    if search:
        rows = conn.execute("""
            SELECT DISTINCT subject_iri, subject_label
            FROM changes
            WHERE subject_label LIKE ?
            ORDER BY subject_label
            LIMIT 100
        """, (f"%{search}%",)).fetchall()
    else:
        rows = conn.execute("""
            SELECT DISTINCT subject_iri, subject_label
            FROM changes
            ORDER BY subject_label
            LIMIT 200
        """).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_entity_history(subject_iri: str, from_ts: str = None, to_ts: str = None, change_type: str = None):
    conn = get_connection()
    query = "SELECT * FROM changes WHERE subject_iri = ?"
    params = [subject_iri]
    if from_ts:
        query += " AND timestamp >= ?"
        params.append(from_ts)
    if to_ts:
        query += " AND timestamp <= ?"
        params.append(to_ts)
    if change_type:
        query += " AND change_type = ?"
        params.append(change_type)
    query += " ORDER BY timestamp ASC"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_neighbours(subject_iri: str):
    conn = get_connection()
    rows = conn.execute("""
        SELECT DISTINCT object_value as iri,
                        object_label  as label,
                        predicate_iri,
                        predicate_label,
                        COUNT(*) as change_count
        FROM changes
        WHERE subject_iri  = ?
          AND change_type  = 'object_property'
          AND object_value LIKE 'http%'
        GROUP BY object_value
        ORDER BY change_count DESC
        LIMIT 50
    """, (subject_iri,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]