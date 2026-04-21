from __future__ import annotations

from sqlalchemy import create_engine, text

from app.core.config import get_settings


STATEMENTS = [
    "alter table tenant_llm_config add column if not exists secret_source varchar(30) default 'none'",
    "alter table tenant_llm_config add column if not exists vault_provider varchar(50)",
    "alter table database_instance_configs add column if not exists connection_secret_reference varchar(255)",
    "alter table database_instance_configs add column if not exists secret_source varchar(30) default 'none'",
    "alter table database_instance_configs add column if not exists vault_provider varchar(50)",
    """
    create table if not exists vault_secrets (
      id varchar(36) primary key,
      secret_ref varchar(255) unique not null,
      provider_type varchar(50) not null,
      scope_type varchar(50) not null,
      scope_id varchar(200) not null,
      secret_kind varchar(50) not null,
      display_name varchar(200),
      secret_masked varchar(64),
      ciphertext text not null,
      metadata_json text not null default '{}',
      created_by_admin_user_id varchar(36),
      last_accessed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
    """,
    "create index if not exists ix_vault_secrets_secret_ref on vault_secrets (secret_ref)",
    "create index if not exists ix_vault_secrets_provider_type on vault_secrets (provider_type)",
    "create index if not exists ix_vault_secrets_scope_type on vault_secrets (scope_type)",
    "create index if not exists ix_vault_secrets_scope_id on vault_secrets (scope_id)",
    "create index if not exists ix_vault_secrets_secret_kind on vault_secrets (secret_kind)",
    "create index if not exists ix_vault_secrets_created_by_admin_user_id on vault_secrets (created_by_admin_user_id)",
]


def main() -> None:
    settings = get_settings()
    engine = create_engine(settings.database_url)
    with engine.begin() as connection:
        for statement in STATEMENTS:
            connection.execute(text(statement))
    print("Vault schema updated")


if __name__ == "__main__":
    main()
