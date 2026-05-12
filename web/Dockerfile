# Stage 1: build React app
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_SIGNALING_URL=ws://localhost/ws
ARG VITE_API_URL=http://localhost/api
ENV VITE_SIGNALING_URL=$VITE_SIGNALING_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# Stage 2: serve with nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
