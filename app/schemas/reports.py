from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


ReportScope = Literal["individual", "group", "organization", "reseller", "global"]
ExportFormat = Literal["csv", "pdf"]


class ReportRunRequest(BaseModel):
    report_type: str = Field(min_length=1, max_length=100)
    dimension: ReportScope
    scope_id: str
    filters: dict[str, str | int | float | bool | None] = Field(default_factory=dict)
    start_date: datetime
    end_date: datetime
    visualization_preferences: dict[str, str | int | bool] = Field(default_factory=dict)


class ReportFilterSet(BaseModel):
    scope_type: ReportScope
    scope_id: str
    start_date: datetime
    end_date: datetime
    include_csv_export: bool = False


class KpiCard(BaseModel):
    label: str
    value: str | int | float
    delta: str | int | float | None = None


class ChartSeriesPoint(BaseModel):
    bucket: str
    value: float | None


class ChartSeries(BaseModel):
    label: str
    points: list[ChartSeriesPoint]


class ReportSummary(BaseModel):
    filters: ReportFilterSet
    report_type: str = "utilization"
    kpis: list[KpiCard] = Field(default_factory=list)
    charts: list[ChartSeries] = Field(default_factory=list)
    tables: list[dict[str, str | int | float | None]] = Field(default_factory=list)
    export_formats: list[str] = Field(default_factory=lambda: ["csv"])


class ReportExportRequest(BaseModel):
    report_type: str = Field(min_length=1, max_length=100)
    dimension: ReportScope
    scope_id: str
    filters: dict[str, str | int | float | bool | None] = Field(default_factory=dict)
    start_date: datetime
    end_date: datetime
    format: ExportFormat = "csv"


class ReportExportJobSummary(BaseModel):
    id: str
    report_type: str
    scope_type: str
    scope_id: str
    format: ExportFormat
    status: str
    file_path: str | None = None
    created_at: datetime
    completed_at: datetime | None = None
