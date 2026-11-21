FROM node:20-slim AS assets
WORKDIR /app
COPY package.json package-lock.json build.js index.html sw.js manifest.json icon.svg icon-192.png icon-512.png ./
COPY css/ ./css/
COPY js/ ./js/
RUN npm ci --no-audit --no-fund && node build.js

FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY --from=assets /app/backend/static ./static
COPY live_state.json ./live_state.json

ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
