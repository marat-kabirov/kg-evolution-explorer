# main.py — точка входа в бэкенд
# FastAPI автоматически создаёт документацию на http://localhost:8000/docs

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
from db import init_db, get_all_entities, get_entity_history, get_neighbours

# Создаём приложение
app = FastAPI(title="KG Evolution API")

# CORS нужен чтобы React (порт 5173) мог обращаться к FastAPI (порт 8000)
# Без этого браузер блокирует запросы между разными портами
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# При старте сервера создаём таблицы если их нет
@app.on_event("startup")
def startup():
    init_db()

# ── Эндпоинты ─────────────────────────────────────────────────────────

@app.get("/entities")
def entities(search: Optional[str] = Query(None)):
    """
    Возвращает список всех сущностей.
    ?search=Hamilton — фильтр по имени
    """
    return get_all_entities(search)

@app.get("/entities/{subject_iri:path}/history")
def history(
    subject_iri: str,
    from_ts: Optional[str] = Query(None),
    to_ts: Optional[str] = Query(None),
    change_type: Optional[str] = Query(None)
):
    """
    История изменений одной сущности.
    subject_iri — IRI сущности (например http://www.wikidata.org/entity/Q9673)
    from_ts / to_ts — фильтр по времени (ISO 8601)
    change_type — object_property | datatype_property | entity_lifecycle
    """
    return get_entity_history(subject_iri, from_ts, to_ts, change_type)

@app.get("/entities/{subject_iri:path}/neighbours")
def neighbours(subject_iri: str):
    """Соседи сущности (1-hop)"""
    return get_neighbours(subject_iri)