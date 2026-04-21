from __future__ import annotations

import base64
import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import VaultSecret


def _normalize_fernet_key(secret: str) -> bytes:
    try:
        decoded = base64.urlsafe_b64decode(secret.encode("utf-8"))
        if len(decoded) == 32:
            return secret.encode("utf-8")
    except Exception:
        pass
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def _load_or_create_local_master_key() -> str:
    settings = get_settings()
    if settings.secret_vault_master_key:
        return settings.secret_vault_master_key

    key_path = Path(settings.secret_vault_local_key_path)
    key_path.parent.mkdir(parents=True, exist_ok=True)
    if key_path.exists():
        return key_path.read_text(encoding="utf-8").strip()

    generated = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("utf-8")
    key_path.write_text(generated, encoding="utf-8")
    try:
        key_path.chmod(0o600)
    except OSError:
        pass
    return generated


def _build_fernet() -> Fernet:
    return Fernet(_normalize_fernet_key(_load_or_create_local_master_key()))


@dataclass
class VaultStoreResult:
    secret_reference: str
    secret_masked: str
    secret_source: str
    vault_provider: str


@dataclass
class VaultResolution:
    value: str | None
    secret_source: str
    vault_provider: str | None
    resolvable: bool
    message: str


@dataclass
class VaultStatus:
    provider: str
    display_name: str
    configured: bool
    writable: bool
    reference_prefix: str
    key_source: str
    azure_key_vault_url: str | None
    managed_secret_count: int
    warnings: list[str]


def mask_secret_value(secret_value: str | None, visible_suffix: int = 4, max_length: int = 32) -> str | None:
    if not secret_value:
        return None
    if len(secret_value) <= visible_suffix:
        return "*" * len(secret_value)
    suffix = secret_value[-visible_suffix:]
    prefix_length = min(max(len(secret_value) - visible_suffix, visible_suffix), max_length - len(suffix))
    return f'{"*" * max(prefix_length, visible_suffix)}{suffix}'


def mask_connection_string(connection_string: str | None) -> str | None:
    if not connection_string:
        return None
    if "://" not in connection_string:
        return mask_secret_value(connection_string, visible_suffix=6, max_length=48)

    scheme, rest = connection_string.split("://", 1)
    if "@" not in rest:
        return f"{scheme}://***"

    auth, host_and_path = rest.split("@", 1)
    if ":" in auth:
        username, _ = auth.split(":", 1)
        masked_auth = f"{username}:***"
    else:
        masked_auth = "***"
    return f"{scheme}://{masked_auth}@{host_and_path}"


def get_vault_status(db: Session) -> VaultStatus:
    settings = get_settings()
    managed_secret_count = 0
    try:
        managed_secret_count = int(db.scalar(select(func.count()).select_from(VaultSecret)) or 0)
    except Exception:
        managed_secret_count = 0

    warnings: list[str] = []
    key_source = "environment"
    if settings.secret_vault_provider == "database_encrypted":
        if settings.secret_vault_master_key:
            key_source = "environment"
        else:
            key_source = "local_file"
            warnings.append("Using a local file-backed master key for development. Set HERMAN_ADMIN_SECRET_VAULT_MASTER_KEY in hosted environments.")

    configured = settings.secret_vault_provider == "database_encrypted"
    writable = configured
    if settings.secret_vault_provider == "azure_key_vault":
        configured = bool(settings.azure_key_vault_url)
        writable = False
        warnings.append("Azure Key Vault provider metadata is configured, but write support is not implemented in this prototype backend yet.")

    return VaultStatus(
        provider=settings.secret_vault_provider,
        display_name="Database Encrypted Vault" if settings.secret_vault_provider == "database_encrypted" else "Azure Key Vault",
        configured=configured,
        writable=writable,
        reference_prefix="vault://database-encrypted/" if settings.secret_vault_provider == "database_encrypted" else "https://<vault>.vault.azure.net/secrets/",
        key_source=key_source,
        azure_key_vault_url=settings.azure_key_vault_url,
        managed_secret_count=managed_secret_count,
        warnings=warnings,
    )


def store_managed_secret(
    db: Session,
    *,
    secret_value: str,
    scope_type: str,
    scope_id: str,
    secret_kind: str,
    display_name: str | None,
    created_by_admin_user_id: str | None,
) -> VaultStoreResult:
    secret_id = str(uuid4())
    secret_ref = f"vault://database-encrypted/{secret_id}"
    token = _build_fernet().encrypt(secret_value.encode("utf-8")).decode("utf-8")
    masked = mask_secret_value(secret_value, max_length=48) or "***"

    db.add(
        VaultSecret(
            id=secret_id,
            secret_ref=secret_ref,
            provider_type="database_encrypted",
            scope_type=scope_type,
            scope_id=scope_id,
            secret_kind=secret_kind,
            display_name=display_name,
            secret_masked=masked,
            ciphertext=token,
            metadata_json=json.dumps({}, sort_keys=True),
            created_by_admin_user_id=created_by_admin_user_id,
        )
    )
    return VaultStoreResult(
        secret_reference=secret_ref,
        secret_masked=masked,
        secret_source="vault_managed",
        vault_provider="database_encrypted",
    )


def resolve_secret_reference(db: Session, secret_reference: str | None) -> VaultResolution:
    if not secret_reference:
        return VaultResolution(
            value=None,
            secret_source="none",
            vault_provider=None,
            resolvable=False,
            message="No secret reference configured",
        )

    if secret_reference.startswith("vault://database-encrypted/"):
        record = db.scalar(select(VaultSecret).where(VaultSecret.secret_ref == secret_reference))
        if record is None:
            return VaultResolution(
                value=None,
                secret_source="vault_managed",
                vault_provider="database_encrypted",
                resolvable=False,
                message="Managed vault secret could not be found",
            )
        try:
            plaintext = _build_fernet().decrypt(record.ciphertext.encode("utf-8")).decode("utf-8")
        except InvalidToken:
            return VaultResolution(
                value=None,
                secret_source="vault_managed",
                vault_provider="database_encrypted",
                resolvable=False,
                message="Managed vault secret exists, but the master key does not match",
            )
        record.last_accessed_at = datetime.now(timezone.utc)
        return VaultResolution(
            value=plaintext,
            secret_source="vault_managed",
            vault_provider="database_encrypted",
            resolvable=True,
            message="Managed vault secret resolved successfully",
        )

    if secret_reference.startswith("https://") and "/secrets/" in secret_reference:
        return VaultResolution(
            value=None,
            secret_source="external_reference",
            vault_provider="azure_key_vault",
            resolvable=False,
            message="External Azure Key Vault references are recognized, but this prototype backend cannot resolve them yet",
        )

    return VaultResolution(
        value=None,
        secret_source="external_reference",
        vault_provider=None,
        resolvable=False,
        message="External secret reference format is not resolvable by this backend",
    )
