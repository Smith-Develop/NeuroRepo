FROM node:22-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY --from=client /app/client/dist /app/client/dist
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "src/index.js"]
