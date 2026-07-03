FROM node:22-slim AS build

WORKDIR /app

ENV DATABASE_URL="postgresql://user:password@localhost:5432/codorobot_db?schema=public"

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma
COPY tsconfig.json ./
COPY prisma.config.ts ./

RUN npm ci

COPY src ./src

RUN npx prisma generate
RUN npm run build


FROM node:22-slim AS production

WORKDIR /app

ENV DATABASE_URL="postgresql://user:password@localhost:5432/codorobot_db?schema=public"

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN npm ci --omit=dev
RUN npx prisma generate

COPY --from=build /app/dist ./dist

EXPOSE 3000

CMD ["sh", "-c", "node dist/src/wait-for-db.js && npx prisma migrate deploy --schema prisma/schema.prisma && node dist/src/server.js"]
