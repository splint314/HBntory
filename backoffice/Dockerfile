FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000

# seed.py is idempotent (it no-ops if users already exist), so it is safe
# to run on every container start.
CMD ["sh", "-c", "python seed.py && python app.py"]
