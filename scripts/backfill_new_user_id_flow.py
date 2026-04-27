from __future__ import annotations

import os
import re
from collections.abc import Iterable

from sqlalchemy import create_engine, text

from app.services import SUMMARY_TYPE_PROFILE_ROWS


PROFILE_FIELDS = (
    "structure",
    "answer_first",
    "tone_directness",
    "detail_level",
    "ambiguity_reduction",
    "exploration_level",
    "context_loading",
    "prompt_enforcement_level",
    "compliance_check_enabled",
    "pii_check_enabled",
    "profile_version",
)

TARGET_TYPE_THREE_USERS = {
    "user-20260425115245-0001",
    "user-20260422130553-0001",
    "user-20260424130634-0001",
}


def infer_initial_user_type(profile_version: str | None) -> int | None:
    normalized = str(profile_version or "").strip().lower()
    if not normalized:
        return None

    for pattern in (r"summary_type_(\d+)$", r"load_test_profile_(\d+)$"):
        match = re.search(pattern, normalized)
        if match:
            value = int(match.group(1))
            if 1 <= value <= 9:
                return value
    return None


def profile_payload(initial_user_type: int) -> dict[str, object]:
    row = dict(SUMMARY_TYPE_PROFILE_ROWS[initial_user_type])
    return {field: row[field] for field in PROFILE_FIELDS}


def format_summary(items: Iterable[str]) -> str:
    materialized = list(items)
    if not materialized:
        return "none"
    return ", ".join(materialized)


def main() -> None:
    database_url = os.environ["HERMAN_ADMIN_DATABASE_URL"]
    engine = create_engine(database_url)

    updated_initial_user_types: list[str] = []
    inserted_type_detail: list[str] = []
    inserted_final_profile: list[str] = []
    repaired_auth_tenants: list[str] = []
    forced_type_three: list[str] = []

    with engine.begin() as connection:
        connection.execute(
            text("alter table user_membership_profiles add column if not exists initial_user_type integer")
        )

        membership_rows = connection.execute(
            text(
                """
                select
                  utm.user_id_hash,
                  utm.tenant_id as membership_tenant_id,
                  ump.id as membership_profile_id,
                  ump.initial_user_type,
                  a.tenant_id as auth_tenant_id,
                  fp.profile_version as final_profile_version,
                  td.profile_version as type_detail_version,
                  case when fp.user_id_hash is not null then true else false end as has_final_profile,
                  case when td.user_id_hash is not null then true else false end as has_type_detail
                from user_tenant_membership utm
                join user_membership_profiles ump on ump.tenant_membership_id = utm.id
                join auth_users a on a.user_id_hash = utm.user_id_hash
                left join final_profile fp on fp.user_id_hash = utm.user_id_hash
                left join type_detail td on td.user_id_hash = utm.user_id_hash
                order by utm.user_id_hash
                """
            )
        ).mappings().all()

        for row in membership_rows:
            user_id_hash = str(row["user_id_hash"])

            if str(row["auth_tenant_id"]) != str(row["membership_tenant_id"]):
                connection.execute(
                    text(
                        """
                        update auth_users
                        set tenant_id = :tenant_id, updated_at = now()
                        where user_id_hash = :user_id_hash
                        """
                    ),
                    {"tenant_id": row["membership_tenant_id"], "user_id_hash": user_id_hash},
                )
                repaired_auth_tenants.append(user_id_hash)

            if user_id_hash in TARGET_TYPE_THREE_USERS:
                resolved_initial_user_type = 3
            else:
                resolved_initial_user_type = (
                    row["initial_user_type"]
                    or infer_initial_user_type(row["type_detail_version"])
                    or infer_initial_user_type(row["final_profile_version"])
                )

            if resolved_initial_user_type is None:
                continue

            if row["initial_user_type"] != resolved_initial_user_type:
                connection.execute(
                    text(
                        """
                        update user_membership_profiles
                        set initial_user_type = :initial_user_type, updated_at = now()
                        where id = :membership_profile_id
                        """
                    ),
                    {
                        "initial_user_type": resolved_initial_user_type,
                        "membership_profile_id": row["membership_profile_id"],
                    },
                )
                updated_initial_user_types.append(user_id_hash)

            if user_id_hash in TARGET_TYPE_THREE_USERS:
                payload = profile_payload(3)
                profile_params = {"user_id_hash": user_id_hash, **payload}

                connection.execute(
                    text(
                        """
                        insert into type_detail (
                          user_id_hash, structure, answer_first, tone_directness, detail_level,
                          ambiguity_reduction, exploration_level, context_loading,
                          prompt_enforcement_level, compliance_check_enabled, pii_check_enabled, profile_version
                        )
                        values (
                          :user_id_hash, :structure, :answer_first, :tone_directness, :detail_level,
                          :ambiguity_reduction, :exploration_level, :context_loading,
                          :prompt_enforcement_level, :compliance_check_enabled, :pii_check_enabled, :profile_version
                        )
                        on conflict (user_id_hash) do update set
                          structure = excluded.structure,
                          answer_first = excluded.answer_first,
                          tone_directness = excluded.tone_directness,
                          detail_level = excluded.detail_level,
                          ambiguity_reduction = excluded.ambiguity_reduction,
                          exploration_level = excluded.exploration_level,
                          context_loading = excluded.context_loading,
                          prompt_enforcement_level = excluded.prompt_enforcement_level,
                          compliance_check_enabled = excluded.compliance_check_enabled,
                          pii_check_enabled = excluded.pii_check_enabled,
                          profile_version = excluded.profile_version,
                          updated_at = now()
                        """
                    ),
                    profile_params,
                )
                connection.execute(
                    text(
                        """
                        insert into final_profile (
                          user_id_hash, structure, answer_first, tone_directness, detail_level,
                          ambiguity_reduction, exploration_level, context_loading,
                          prompt_enforcement_level, compliance_check_enabled, pii_check_enabled, profile_version
                        )
                        values (
                          :user_id_hash, :structure, :answer_first, :tone_directness, :detail_level,
                          :ambiguity_reduction, :exploration_level, :context_loading,
                          :prompt_enforcement_level, :compliance_check_enabled, :pii_check_enabled, :profile_version
                        )
                        on conflict (user_id_hash) do update set
                          structure = excluded.structure,
                          answer_first = excluded.answer_first,
                          tone_directness = excluded.tone_directness,
                          detail_level = excluded.detail_level,
                          ambiguity_reduction = excluded.ambiguity_reduction,
                          exploration_level = excluded.exploration_level,
                          context_loading = excluded.context_loading,
                          prompt_enforcement_level = excluded.prompt_enforcement_level,
                          compliance_check_enabled = excluded.compliance_check_enabled,
                          pii_check_enabled = excluded.pii_check_enabled,
                          profile_version = excluded.profile_version,
                          updated_at = now()
                        """
                    ),
                    profile_params,
                )
                forced_type_three.append(user_id_hash)
                continue

            if not row["has_type_detail"] and row["has_final_profile"]:
                connection.execute(
                    text(
                        """
                        insert into type_detail (
                          user_id_hash, structure, answer_first, tone_directness, detail_level,
                          ambiguity_reduction, exploration_level, context_loading,
                          prompt_enforcement_level, compliance_check_enabled, pii_check_enabled, profile_version
                        )
                        select
                          user_id_hash, structure, answer_first, tone_directness, detail_level,
                          ambiguity_reduction, exploration_level, context_loading,
                          prompt_enforcement_level, compliance_check_enabled, pii_check_enabled, profile_version
                        from final_profile
                        where user_id_hash = :user_id_hash
                        on conflict (user_id_hash) do nothing
                        """
                    ),
                    {"user_id_hash": user_id_hash},
                )
                inserted_type_detail.append(user_id_hash)

            if not row["has_final_profile"] and row["has_type_detail"]:
                connection.execute(
                    text(
                        """
                        insert into final_profile (
                          user_id_hash, structure, answer_first, tone_directness, detail_level,
                          ambiguity_reduction, exploration_level, context_loading,
                          prompt_enforcement_level, compliance_check_enabled, pii_check_enabled, profile_version
                        )
                        select
                          user_id_hash, structure, answer_first, tone_directness, detail_level,
                          ambiguity_reduction, exploration_level, context_loading,
                          prompt_enforcement_level, compliance_check_enabled, pii_check_enabled, profile_version
                        from type_detail
                        where user_id_hash = :user_id_hash
                        on conflict (user_id_hash) do nothing
                        """
                    ),
                    {"user_id_hash": user_id_hash},
                )
                inserted_final_profile.append(user_id_hash)

    print(f"Updated initial_user_type for: {format_summary(updated_initial_user_types)}")
    print(f"Inserted type_detail from final_profile for: {format_summary(inserted_type_detail)}")
    print(f"Inserted final_profile from type_detail for: {format_summary(inserted_final_profile)}")
    print(f"Forced Type 3 profiles for: {format_summary(forced_type_three)}")
    print(f"Repaired auth tenant mismatch for: {format_summary(repaired_auth_tenants)}")


if __name__ == "__main__":
    main()
