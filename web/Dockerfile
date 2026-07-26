# Build context is the REPO ROOT, not web/ — see deploy/docker-compose.yml.
# The app imports shared components through the `@pd/ui` alias, which both the
# Vite config and tsconfig resolve to ../shared/ui, so that directory has to be
# present in the image. Building from web/ alone fails with 27 TS2307 errors.
# A repo-root .dockerignore keeps everything else (notably a ~17 GB Rust
# target/) out of the context.

# Stage 1: build React app
FROM node:20-alpine AS builder
WORKDIR /repo

# Dependencies first, so a source-only change does not re-run npm ci.
COPY web/package*.json ./web/
RUN cd web && npm ci

COPY shared ./shared
COPY web ./web
RUN cd web && npm run build

# Stage 2: serve with nginx
FROM nginx:alpine
COPY --from=builder /repo/web/dist /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
