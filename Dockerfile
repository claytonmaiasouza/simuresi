FROM node:20-alpine
# Alpine's base image ships OpenSSL 3 libs but not the `openssl` CLI, which
# Prisma's runtime engine-selection shells out to. Without it, Prisma can't
# detect the OpenSSL version and silently loads an incompatible 1.1.x-built
# engine binary that fails with "Error loading shared library libssl.so.1.1".
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY prisma ./prisma
RUN npx prisma generate
COPY src ./src
COPY frontend ./frontend
EXPOSE 3000
CMD ["node", "src/server.js"]
