export type CqiMatchStatus = "not_found" | "single_match" | "multiple_matches" | "error";

export type CqiProfileVector = {
  structure: number;
  answer_first: number;
  tone_directness: number;
  detail_level: number;
  ambiguity_reduction: number;
  exploration_level: number;
  context_loading: number;
  profile_version: string;
  prompt_enforcement_level: string;
  compliance_check_enabled: boolean;
  pii_check_enabled: boolean;
};

export type CqiProfilePreview = {
  candidate_layer: string;
  candidate_type: number | null;
  inferred_profile: CqiProfileVector;
  reasoning: string[];
  confidence: number;
  mapped_fields: Record<string, string>;
};

export type CqiRawRecord = {
  airtable_record_id: string;
  fields: Record<string, unknown>;
};

export type CqiPreviewRequest = {
  tenant_id: string;
  email: string;
};

export type CqiPreviewResponse = {
  tenant_id: string;
  requested_email: string;
  normalized_email: string;
  found: boolean;
  match_status: CqiMatchStatus;
  match_count: number;
  raw_record: CqiRawRecord | null;
  profile_preview: CqiProfilePreview | null;
  warnings: string[];
  looked_up_at_utc: string;
  source: {
    provider: "airtable";
    table_name: string;
    base_id: string;
  };
};
