FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY prisma ./prisma
RUN npx prisma generate
COPY src ./src
COPY frontend ./frontend
EXPOSE 3000
CMD ["node", "src/server.js"]
