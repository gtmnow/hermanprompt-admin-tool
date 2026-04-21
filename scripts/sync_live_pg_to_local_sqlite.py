from __future__ import annotations

import json
import os
import shutil
import sqlite3
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import psycopg


PG_TO_SQLITE_TYPE = {
    "bigint": "INTEGER",
    "integer": "INTEGER",
    "smallint": "INTEGER",
    "boolean": "INTEGER",
    "character varying": "TEXT",
    "character": "TEXT",
    "text": "TEXT",
    "uuid": "TEXT",
    "json": "TEXT",
    "jsonb": "TEXT",
    "timestamp without time zone": "TEXT",
    "timestamp with time zone": "TEXT",
    "date": "TEXT",
    "time without time zone": "TEXT",
    "time with time zone": "TEXT",
    "double precision": "REAL",
    "real": "REAL",
    "numeric": "TEXT",
    "bytea": "BLOB",
}


def quote_ident(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def normalize_value(value: object) -> object:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float, str, bytes)):
        return value
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (list, tuple, dict)):
        return json.dumps(value, default=str, sort_keys=True)
    return str(value)


def build_column_sql(column_name: str, data_type: str, is_nullable: str) -> str:
    sqlite_type = PG_TO_SQLITE_TYPE.get(data_type, "TEXT")
    not_null = " NOT NULL" if is_nullable == "NO" else ""
    return f"{quote_ident(column_name)} {sqlite_type}{not_null}"


def main() -> None:
    database_url = os.environ["DATABASE_URL"]
    sqlite_path = Path(os.environ.get("SQLITE_PATH", "data/herman_admin.db"))
    backup_path = sqlite_path.with_suffix(sqlite_path.suffix + ".pre_live_sync.bak")
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)

    if sqlite_path.exists():
        shutil.copy2(sqlite_path, backup_path)

    pg_dsn = database_url.replace("postgresql+psycopg://", "postgresql://", 1)

    with psycopg.connect(pg_dsn) as pg_conn, sqlite3.connect(sqlite_path) as sqlite_conn:
        pg_conn.autocommit = False
        sqlite_conn.execute("PRAGMA foreign_keys = OFF")

        tables = []
        with pg_conn.cursor() as cur:
            cur.execute(
                """
                select table_name
                from information_schema.tables
                where table_schema = 'public'
                  and table_type = 'BASE TABLE'
                order by table_name
                """
            )
            tables = [row[0] for row in cur.fetchall()]

        imported_counts: list[tuple[str, int]] = []

        for table_name in tables:
            with pg_conn.cursor() as cur:
                cur.execute(
                    """
                    select column_name, data_type, is_nullable
                    from information_schema.columns
                    where table_schema = 'public' and table_name = %s
                    order by ordinal_position
                    """,
                    (table_name,),
                )
                columns = cur.fetchall()

                column_names = [row[0] for row in columns]
                column_sql = ", ".join(build_column_sql(name, data_type, nullable) for name, data_type, nullable in columns)
                sqlite_conn.execute(f"DROP TABLE IF EXISTS {quote_ident(table_name)}")
                sqlite_conn.execute(f"CREATE TABLE {quote_ident(table_name)} ({column_sql})")

                select_sql = f"SELECT * FROM public.{quote_ident(table_name)}"
                cur.execute(select_sql)
                rows = cur.fetchall()

                if rows:
                    placeholders = ", ".join("?" for _ in column_names)
                    insert_sql = (
                        f"INSERT INTO {quote_ident(table_name)} "
                        f"({', '.join(quote_ident(name) for name in column_names)}) "
                        f"VALUES ({placeholders})"
                    )
                    sqlite_conn.executemany(insert_sql, [[normalize_value(value) for value in row] for row in rows])

                imported_counts.append((table_name, len(rows)))

        sqlite_conn.execute(
            """
            CREATE TABLE IF NOT EXISTS live_snapshot_metadata (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT NOT NULL,
                synced_at TEXT NOT NULL,
                table_count INTEGER NOT NULL,
                row_counts_json TEXT NOT NULL
            )
            """
        )
        sqlite_conn.execute(
            """
            INSERT INTO live_snapshot_metadata (source, synced_at, table_count, row_counts_json)
            VALUES (?, ?, ?, ?)
            """,
            (
                "railway",
                datetime.utcnow().isoformat(),
                len(imported_counts),
                json.dumps({table: count for table, count in imported_counts}, sort_keys=True),
            ),
        )
        sqlite_conn.commit()

    print(f"Backed up existing SQLite DB to {backup_path}")
    print(f"Synchronized {len(imported_counts)} public tables into {sqlite_path}")
    for table_name, count in imported_counts:
        print(f"{table_name}: {count}")


if __name__ == "__main__":
    main()
