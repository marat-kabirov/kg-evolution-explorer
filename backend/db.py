# db.py — всё что связано с базой данных
# SQLite это просто один файл на диске, не нужен отдельный сервер

import sqlite3
import os

# Путь к файлу базы данных
DB_PATH = os.path.join(os.path.dirname(__file__), "data", "changelog.db")

def get_connection():
    """Открывает соединение с базой данных"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # чтобы результаты были как словари
    return conn

def init_db():
    """Создаёт таблицу если её ещё нет"""
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
    # Индекс — это как оглавление в книге
    # Без него поиск по subject_iri был бы медленным (перебирал бы все строки)
    # С индексом — мгновенный поиск даже в 100k строк
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_subject_ts 
        ON changes(subject_iri, timestamp)
    """)
    conn.commit()
    conn.close()

def get_all_entities(search: str = None):
    """Возвращает список всех уникальных сущностей"""
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
    """Возвращает полную историю изменений одной сущности"""
    conn = get_connection()
    
    # Строим запрос динамически в зависимости от фильтров
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
        SELECT DISTINCT object_value as iri, object_label as label,
               predicate_iri, predicate_label,
               COUNT(*) as change_count
        FROM changes
        WHERE subject_iri = ?
          AND change_type = 'object_property'
          AND object_value LIKE 'http%'
        GROUP BY object_value
        ORDER BY change_count DESC
        LIMIT 12
      """, (subject_iri,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]