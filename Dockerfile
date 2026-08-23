FROM node:22-slim
WORKDIR /app

COPY client/package*.json client/
COPY worker/package*.json worker/

RUN npm --prefix client install --no-audit --no-fund \
 && npm --prefix worker install --no-audit --no-fund

EXPOSE 8787

CMD ["sh", "-c", "npm --prefix client run watch & exec npm --prefix worker run dev"]
