FROM node:22-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-alpine
# OCR de escaneos e imágenes (ver server/src/ocr.js): tesseract con español + pdftoppm de poppler.
# Con reintentos: el DNS de Docker Desktop falla a veces de forma transitoria al bajar el índice de apk.
RUN for i in 1 2 3 4 5; do apk add --no-cache tesseract-ocr tesseract-ocr-data-spa poppler-utils && exit 0; sleep 5; done; exit 1
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY --from=client /app/client/dist /app/client/dist
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "src/index.js"]
