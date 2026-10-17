# Build Expo Web → assets statiques, servi par nginx
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV EXPO_NO_TELEMETRY=1
RUN npx expo export --platform web --output-dir dist \
  && mkdir -p dist \
  && cp -f public/download.html dist/download.html \
  && cp -f public/lab-connect.html dist/lab-connect.html \
  && cp -f public/manifest.webmanifest dist/manifest.webmanifest \
  && cp -f public/sw.js dist/sw.js \
  && cp -f public/updates.json dist/updates.json \
  && cp -f assets/icon.png dist/icon.png \
  && cp -f assets/icon.png dist/apple-touch-icon.png \
  && VERSION=$(node -p "require('./app.json').expo.version") \
  && sed -i "s/gasoil-shell-v1\\.4\\.9/gasoil-shell-v${VERSION}/g" dist/sw.js \
  && echo "SW cache stamped: gasoil-shell-v${VERSION}"

FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="Gasoil Tracking"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
