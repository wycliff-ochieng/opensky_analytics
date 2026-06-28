FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY ingest.py ./
COPY test ./test

EXPOSE 8001

CMD ["python", "-u", "ingest.py"]