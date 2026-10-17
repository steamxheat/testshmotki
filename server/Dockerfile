# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# node_modules из build-стадии содержат сгенерированный Prisma Client и CLI (для migrate deploy)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh && mkdir -p uploads
EXPOSE 4000
CMD ["./docker-entrypoint.sh"]
