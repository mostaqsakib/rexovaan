# Playwright's official image — keep this version matched with package.json.
FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

# Install Node deps first for layer caching
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund || npm install --no-audit --no-fund

# Copy the rest of the bot source
COPY . .

# Railway sets PORT, but we don't bind one — just run both processes.
CMD ["npm", "run", "start:all"]
