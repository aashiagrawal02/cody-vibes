# Container image for hosting Cody Vibes (used by Render, works with any Docker host).
# The full Node image already includes Python 3, gcc and g++; we add Ruby and Java
# so every language in the code runner works.
FROM node:20-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends ruby openjdk-17-jdk-headless \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first so Docker can cache this layer
COPY package.json package-lock.json ./
RUN npm ci

# Copy the app and bundle the browser code
COPY . .
RUN npm run build

# Run as the unprivileged "node" user, so code people run can't change the system
RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server/index.js"]
