FROM node:22-slim AS frontend-builder

WORKDIR /frontend

COPY package.json package-lock.json tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html ./
COPY src ./src

RUN npm ci
RUN npm run build

FROM python:3.13-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY pyproject.toml README.md ./
COPY app ./app
COPY --from=frontend-builder /frontend/dist ./frontend_dist

RUN pip install --no-cache-dir .

CMD ["sh", "-c", "python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
