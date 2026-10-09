FROM node:20-slim

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy the rest of the application code
COPY . .

# Set production environment
ENV NODE_ENV=production

# Cloud Run defaults to port 8080 (overrideable via PORT env var)
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
