import json
import logging
from datetime import timezone, datetime
from time import perf_counter

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ReportExportJob
from app.schemas import (
    ListEnvelope,
    ReportExportJobSummary,
    ReportExportRequest,
    ReportFilterSet,
    ReportRunRequest,
    ReportSummary,
    ResourceEnvelope,
)
from app.schemas.reports import ChartSeries, ChartSeriesPoint, KpiCard
from app.security import Principal, require_permission
from app.services import (
    build_report_payload,
    create_export_file,
    ensure_scope_access,
    get_group_or_404,
    get_tenant_or_404,
    write_audit_log,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def ensure_report_scope_access(db: Session, principal: Principal, dimension: str, scope_id: str) -> None:
    reseller_partner_id: str | None = None
    tenant_id: str | None = None
    group_id: str | None = None

    if dimension == "reseller":
        reseller_partner_id = scope_id
    elif dimension == "organization":
        tenant = get_tenant_or_404(db, scope_id)
        reseller_partner_id = tenant.reseller_partner_id
        tenant_id = tenant.id
    elif dimension == "group":
        group = get_group_or_404(db, scope_id)
        tenant = get_tenant_or_404(db, group.tenant_id)
        reseller_partner_id = tenant.reseller_partner_id
        tenant_id = tenant.id
        group_id = group.id
    else:
        tenant_id = scope_id if dimension == "organization" else None
        group_id = scope_id if dimension == "group" else None

    ensure_scope_access(
        principal,
        reseller_partner_id=reseller_partner_id,
        tenant_id=tenant_id,
        group_id=group_id,
    )


@router.post("/run", response_model=ResourceEnvelope[ReportSummary])
def run_report(
    payload: ReportRunRequest,
    principal: Principal = Depends(require_permission("analytics.read")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[ReportSummary]:
    started_at = perf_counter()
    ensure_report_scope_access(db, principal, payload.dimension, payload.scope_id)
    metrics_started_at = perf_counter()
    metrics = build_report_payload(db, payload.dimension, payload.scope_id, payload.start_date, payload.end_date)
    metrics_duration_ms = round((perf_counter() - metrics_started_at) * 1000, 1)
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
                label="Usage Trend",
                points=[ChartSeriesPoint(bucket=item["bucket"], value=item["value"]) for item in metrics["usage_series"]],
            ),
            ChartSeries(
                label="Improvement Trend",
                points=[ChartSeriesPoint(bucket=item["bucket"], value=item["value"]) for item in metrics["improvement_series"]],
            ),
            ChartSeries(
                label="Admin Token Consumption Trend",
                points=[ChartSeriesPoint(bucket=item["bucket"], value=item["value"]) for item in metrics["admin_token_series"]],
            ),
            ChartSeries(
                label="User Response Token Consumption Trend",
                points=[ChartSeriesPoint(bucket=item["bucket"], value=item["value"]) for item in metrics["user_response_token_series"]],
            ),
            ChartSeries(
                label="Total Token Utilization Trend",
                points=[ChartSeriesPoint(bucket=item["bucket"], value=item["value"]) for item in metrics["total_token_series"]],
            ),
            ChartSeries(
                label="User Token Efficiency Trend",
                points=[ChartSeriesPoint(bucket=item["bucket"], value=item["value"]) for item in metrics["token_efficiency_series"]],
            ),
        ],
        tables=[
            {"metric": "tenant_count", "value": metrics["tenant_count"]},
            {"metric": "active_users", "value": metrics["active_users"]},
            {"metric": "session_count", "value": metrics["session_count"]},
            {"metric": "active_groups", "value": metrics["active_groups"]},
        ],
    )
    logger.info(
        "reports.run completed",
        extra={
            "context": {
                "role": principal.role,
                "scope_count": len(principal.scopes),
                "dimension": payload.dimension,
                "scope_id": payload.scope_id,
                "report_type": payload.report_type,
                "metrics_duration_ms": metrics_duration_ms,
                "duration_ms": round((perf_counter() - started_at) * 1000, 1),
            }
        },
    )
    return ResourceEnvelope[ReportSummary](resource=summary)


@router.post("/export", response_model=ResourceEnvelope[ReportExportJobSummary], status_code=status.HTTP_201_CREATED)
def create_report_export(
    payload: ReportExportRequest,
    request_id: str | None = Header(default=None, alias="X-Request-ID"),
    principal: Principal = Depends(require_permission("analytics.export")),
    db: Session = Depends(get_db),
) -> ResourceEnvelope[ReportExportJobSummary]:
    ensure_report_scope_access(db, principal, payload.dimension, payload.scope_id)
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

    metrics = build_report_payload(db, payload.dimension, payload.scope_id, payload.start_date, payload.end_date)
    job.file_path = create_export_file(job, metrics)
    job.status = "complete"
    job.completed_at = datetime.now(timezone.utc)

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


@router.get("/export", response_model=ListEnvelope[ReportExportJobSummary])
def list_report_exports(
    scope_type: str | None = Query(default=None),
    scope_id: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    principal: Principal = Depends(require_permission("analytics.export")),
    db: Session = Depends(get_db),
) -> ListEnvelope[ReportExportJobSummary]:
    query = select(ReportExportJob).order_by(ReportExportJob.created_at.desc())
    if scope_type:
        query = query.where(ReportExportJob.scope_type == scope_type)
    if scope_id:
        query = query.where(ReportExportJob.scope_id == scope_id)
    if status_filter:
        query = query.where(ReportExportJob.status == status_filter)

    items = []
    for job in db.scalars(query):
        ensure_report_scope_access(db, principal, job.scope_type, job.scope_id)
        items.append(ReportExportJobSummary.model_validate(job, from_attributes=True))

    start = (page - 1) * page_size
    end = start + page_size
    return ListEnvelope[ReportExportJobSummary](
        items=items[start:end],
        page=page,
        page_size=page_size,
        total_count=len(items),
        filters={"scope_type": scope_type, "scope_id": scope_id, "status": status_filter},
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
    ensure_report_scope_access(db, principal, job.scope_type, job.scope_id)
    return ResourceEnvelope[ReportExportJobSummary](
        resource=ReportExportJobSummary.model_validate(job, from_attributes=True),
        updated_at=job.completed_at or job.created_at,
    )
