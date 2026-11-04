FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.js ./
COPY src ./src
COPY config ./config
COPY prompts ./prompts
ENV NODE_ENV=production HOST=0.0.0.0 DATA_DIR=/app/data
USER node
EXPOSE 3000
CMD ["node", "index.js"]
