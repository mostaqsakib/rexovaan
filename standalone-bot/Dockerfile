# Playwright's official image — Chromium + all system deps preinstalled.
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

# Install Node deps first for layer caching
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund || npm install --no-audit --no-fund

# Copy the rest of the bot source
COPY . .

# Railway sets PORT, but we don't bind one — just run both processes.
CMD ["npm", "run", "start:all"]
