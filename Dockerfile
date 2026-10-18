FROM m.daocloud.io/docker.io/library/node:22-bookworm-slim AS frontend-builder

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
RUN npm run build


FROM m.daocloud.io/docker.io/library/python:3.12-slim AS application

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    JOB_EVIDENCE_FRONTEND_DIST_DIR=/app/frontend-dist

WORKDIR /app
COPY pyproject.toml ./
COPY backend/src/ ./backend/src/
RUN pip install .
COPY --from=frontend-builder /build/frontend/dist/ ./frontend-dist/

EXPOSE 8000
CMD ["uvicorn", "job_evidence_agent.app:app", "--host", "0.0.0.0", "--port", "8000"]
