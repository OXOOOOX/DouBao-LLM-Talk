FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for server and frontend)
RUN npm ci

# Copy all source files
COPY *.js *.html ./
COPY src ./src

# Expose port 8080 for Zeabur
EXPOSE 8080

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/config || exit 1

# Start the server
CMD ["npm", "run", "server"]
