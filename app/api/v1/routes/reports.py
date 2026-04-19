import json
from datetime import timezone, datetime

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ReportExportJob
from app.schemas import (
    ReportExportJobSummary,
    ReportExportRequest,
    ReportFilterSet,
    ReportRunRequest,
    ReportSummary,
    ResourceEnvelope,
)
from app.schemas.reports import ChartSeries, ChartSeriesPoint, KpiCard
from app.security import Principal, require_permission
from app.services import build_report_payload, create_export_file, ensure_scope_access, write_audit_log

router = APIRouter()


@router.post("/run", response_model=ResourceEnvelope[ReportSummary])
def run_report(
    payload: ReportRunRequest,
    principal: Principal = Depends(require_permission("analytics.read")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[ReportSummary]:
    ensure_scope_access(
        principal,
        reseller_partner_id=payload.scope_id if payload.dimension == "reseller" else None,
        tenant_id=payload.scope_id if payload.dimension == "organization" else None,
        group_id=payload.scope_id if payload.dimension == "group" else None,
    )
    metrics = build_report_payload(db, payload.dimension, payload.scope_id, payload.start_date, payload.end_date)
    summary = ReportSummary(
        report_type=payload.report_type,
        filters=ReportFilterSet(
            scope_type=payload.dimension,
            scope_id=payload.scope_id,
            start_date=payload.start_date,
            end_date=payload.end_date,
            include_csv_export=True,
        ),
        kpis=[
            KpiCard(label="Active Users", value=metrics["active_users"]),
            KpiCard(label="Active Groups", value=metrics["active_groups"]),
            KpiCard(label="Average Improvement", value=f"{metrics['average_improvement']}%"),
        ],
        charts=[
            ChartSeries(
                label="Improvement Trend",
                points=[ChartSeriesPoint(bucket=item["bucket"], value=item["value"]) for item in metrics["series"]],
            )
        ],
        tables=[
            {"metric": "tenant_count", "value": metrics["tenant_count"]},
            {"metric": "active_users", "value": metrics["active_users"]},
            {"metric": "active_groups", "value": metrics["active_groups"]},
        ],
    )
    return ResourceEnvelope[ReportSummary](resource=summary)


@router.post("/export", response_model=ResourceEnvelope[ReportExportJobSummary], status_code=status.HTTP_201_CREATED)
def create_report_export(
    payload: ReportExportRequest,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("analytics.export")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[ReportExportJobSummary]:
    ensure_scope_access(
        principal,
        reseller_partner_id=payload.scope_id if payload.dimension == "reseller" else None,
        tenant_id=payload.scope_id if payload.dimension == "organization" else None,
        group_id=payload.scope_id if payload.dimension == "group" else None,
    )
    job = ReportExportJob(
        requested_by_admin_user_id=principal.admin_id,
        report_type=payload.report_type,
        scope_type=payload.dimension,
        scope_id=payload.scope_id,
        filters_json=json.dumps(payload.filters, sort_keys=True),
        format=payload.format,
        status="queued",
    )
    db.add(job)
    db.flush()

    if payload.format == "csv":
        metrics = build_report_payload(db, payload.dimension, payload.scope_id, payload.start_date, payload.end_date)
        job.file_path = create_export_file(job, metrics)
        job.status = "complete"
        job.completed_at = datetime.now(timezone.utc)
    else:
        job.status = "queued"

    write_audit_log(
        db,
        principal,
        action_type="report.export.create",
        target_type="report_export_job",
        target_id=job.id,
        after=json.dumps({"status": job.status, "format": job.format, "scope_id": job.scope_id}),
        request_id=request_id,
    )
    db.commit()
    return ResourceEnvelope[ReportExportJobSummary](
        resource=ReportExportJobSummary.model_validate(job, from_attributes=True),
        updated_at=job.completed_at or job.created_at,
    )


@router.get("/export/{job_id}", response_model=ResourceEnvelope[ReportExportJobSummary])
def get_report_export(
    job_id: str,
    principal: Principal = Depends(require_permission("analytics.export")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[ReportExportJobSummary]:
    job = db.get(ReportExportJob, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export job not found")
    ensure_scope_access(
        principal,
        reseller_partner_id=job.scope_id if job.scope_type == "reseller" else None,
        tenant_id=job.scope_id if job.scope_type == "organization" else None,
        group_id=job.scope_id if job.scope_type == "group" else None,
    )
    return ResourceEnvelope[ReportExportJobSummary](
        resource=ReportExportJobSummary.model_validate(job, from_attributes=True),
        updated_at=job.completed_at or job.created_at,
    )
