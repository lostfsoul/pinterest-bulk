FROM node:20-bookworm-slim AS frontend-build

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build


FROM node:20-bookworm-slim AS renderer-build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg62-turbo-dev \
    libgif-dev \
    librsvg2-dev \
    libwebp-dev \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend/node_renderer
COPY backend/node_renderer/package*.json ./
RUN npm ci
COPY backend/node_renderer/ ./


FROM node:20-bookworm-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    libcairo2 \
    libpango-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    libwebp7 \
    fontconfig \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt /app/backend/requirements.txt
RUN python3 -m pip install --no-cache-dir --break-system-packages -r /app/backend/requirements.txt

COPY backend /app/backend
COPY --from=frontend-build /app/frontend/dist /app/backend/static
COPY --from=renderer-build /app/backend/node_renderer /app/backend/node_renderer

RUN mkdir -p \
    /app/data \
    /app/storage \
    /app/storage/generated_pins \
    /app/storage/overlays \
    /app/storage/templates \
    /app/storage/images \
    /app/storage/exports

EXPOSE 8000

CMD ["sh", "-c", "cd /app/backend && python3 -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
