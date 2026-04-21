from __future__ import annotations

import os
import sqlite3
from pathlib import Path

import psycopg
from sqlalchemy import create_engine

from app.db import Base
from app import models  # noqa: F401


TABLES_IN_INSERT_ORDER = [
    "reseller_partners",
    "tenants",
    "tenant_profiles",
    "tenant_runtime_settings",
    "tenant_onboarding_status",
    "tenant_llm_config",
    "admin_users",
    "admin_profiles",
    "admin_permissions",
    "admin_scopes",
    "groups",
    "group_profiles",
    "user_tenant_membership",
    "user_membership_profiles",
    "user_invitations",
    "user_group_membership",
    "database_instance_configs",
    "prompt_ui_instance_configs",
    "platform_managed_llm_configs",
    "tenant_portal_configs",
]


def quote_ident(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def fetch_sqlite_rows(conn: sqlite3.Connection, table_name: str) -> tuple[list[str], list[tuple[object, ...]]]:
    columns = [row[1] for row in conn.execute(f"PRAGMA table_info({quote_ident(table_name)})").fetchall()]
    rows = conn.execute(f"SELECT * FROM {quote_ident(table_name)}").fetchall()
    return columns, rows


def fetch_pg_column_types(cur: psycopg.Cursor, table_name: str) -> dict[str, str]:
    cur.execute(
        """
        select column_name, data_type
        from information_schema.columns
        where table_schema = 'public' and table_name = %s
        """,
        (table_name,),
    )
    return {row[0]: row[1] for row in cur.fetchall()}


def normalize_row(row: tuple[object, ...], columns: list[str], pg_column_types: dict[str, str]) -> tuple[object, ...]:
    normalized: list[object] = []
    for column, value in zip(columns, row, strict=True):
        data_type = pg_column_types.get(column)
        if value is None:
            normalized.append(None)
        elif data_type == "boolean":
            normalized.append(bool(value))
        else:
            normalized.append(value)
    return tuple(normalized)


def main() -> None:
    database_url = os.environ["DATABASE_URL"]
    sqlite_path = Path(os.environ.get("SQLITE_PATH", "data/herman_admin.db"))
    if not sqlite_path.exists():
        raise FileNotFoundError(f"SQLite source database not found: {sqlite_path}")

    sqlalchemy_dsn = database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    engine = create_engine(sqlalchemy_dsn)
    Base.metadata.create_all(bind=engine)

    with sqlite3.connect(sqlite_path) as sqlite_conn:
        pg_dsn = database_url.replace("postgresql+psycopg://", "postgresql://", 1)
        with psycopg.connect(pg_dsn) as pg_conn:
            with pg_conn.cursor() as cur:
                for table_name in reversed(TABLES_IN_INSERT_ORDER):
                    cur.execute(f"DELETE FROM {quote_ident(table_name)}")

                for table_name in TABLES_IN_INSERT_ORDER:
                    columns, rows = fetch_sqlite_rows(sqlite_conn, table_name)
                    pg_column_types = fetch_pg_column_types(cur, table_name)
                    if not rows:
                        print(f"{table_name}: 0 rows copied")
                        continue

                    column_list = ", ".join(quote_ident(column) for column in columns)
                    placeholders = ", ".join(["%s"] * len(columns))
                    insert_sql = (
                        f"INSERT INTO {quote_ident(table_name)} ({column_list}) "
                        f"VALUES ({placeholders})"
                    )
                    cur.executemany(insert_sql, [normalize_row(row, columns, pg_column_types) for row in rows])
                    print(f"{table_name}: {len(rows)} rows copied")

            pg_conn.commit()


if __name__ == "__main__":
    main()
