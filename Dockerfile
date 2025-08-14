# Simple container for gastos app
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy app
COPY . .

# Expose port (Render/Heroku use $PORT)
ENV PORT=8080
# Allow external data dir (optional); default inside container
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data

# Start
CMD ["npm", "start"]
