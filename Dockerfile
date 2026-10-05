# syntax=docker/dockerfile:1
#
# Two-stage image: build the static site with Node, serve it with nginx.
#   docker build -t win95-3d-maze .
#   docker run --rm -p 8080:8080 win95-3d-maze      → http://localhost:8080

# ---- 1. build ---------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---- 2. serve ---------------------------------------------------------------
FROM nginx:1.28-alpine

# Full nginx.conf (not a conf.d snippet): listens on 8080, pid/temp files in /tmp,
# so the server runs as the unprivileged 'nginx' user that the base image ships.
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=builder /app/dist /usr/share/nginx/html

RUN chown -R nginx:nginx /usr/share/nginx/html

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
