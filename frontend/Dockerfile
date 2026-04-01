FROM node:20-alpine

WORKDIR /app

# Copy both files explicitly so the lockfile is always in the image (see npm ci requirements).
COPY package.json package-lock.json ./

# `npm ci` fails if the lockfile is missing, empty, or out of sync with package.json (common after
# dependency bumps). `npm install` fixes the tree during the image build; to use `npm ci` again,
# run `npm install` in ./frontend, commit the updated package-lock.json, then change this line to npm ci.
RUN npm install --no-audit --no-fund

# Copy application code
COPY . .

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Expose port
EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"]
