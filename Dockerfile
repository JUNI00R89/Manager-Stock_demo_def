# Servidor de Manager Stock (API FastAPI + SQLite) para publicarlo en la nube.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MANAGER_STOCK_DB=/data/manager_stock.db

WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend backend
COPY database database
RUN mkdir -p /data

# Render (y la mayoría de proveedores) indican el puerto en $PORT.
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
