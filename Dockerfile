FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine AS production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main"]
