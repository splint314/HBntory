FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000

# seed.py is idempotent (it no-ops if users already exist), so it is safe
# to run on every container start. gunicorn instead of `python app.py`:
# the Werkzeug dev server used for local runs is not meant to take
# production traffic (no debug mode here either way, see app.py).
CMD ["sh", "-c", "python seed.py && gunicorn --bind 0.0.0.0:5000 --workers 2 --threads 4 --timeout 60 app:app"]
