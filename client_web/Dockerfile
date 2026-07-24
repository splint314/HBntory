FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# No framework, no build step (see client_web/README.md): the static files
# are served as-is, same approach as backoffice/static/.
COPY . .

EXPOSE 5173

CMD ["python3", "-m", "http.server", "5173"]
