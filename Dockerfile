# syntax=docker/dockerfile:1
#
# CI/CD image for the GP API Validator. Based on Microsoft's official Playwright
# image so the Firefox browser + OS-level dependencies are already baked in and
# version-matched to the "playwright" npm package pinned in package.json -
# avoiding the "download browsers on every pipeline run" cost/flakiness.
#
# IMPORTANT: if you bump the "playwright" version in package.json, bump the tag
# below to match (mcr.microsoft.com/playwright:v<version>-jammy).
FROM mcr.microsoft.com/playwright:v1.54.1-jammy

# Java + Maven (for sdk-verifiers/java) and PHP + Composer (for sdk-verifiers/php).
# The Node.js verifier needs nothing extra - it reuses this image's Node + the
# globalpayments-api package installed by `npm ci` below.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
        openjdk-17-jdk-headless \
        maven \
        php-cli \
        php-xml \
        php-mbstring \
        php-curl \
        composer \
        unzip \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies first so this layer is cached unless package*.json changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Bring in the rest of the tool, then build the standalone SDK verifiers.
COPY . .
RUN cd sdk-verifiers/php && composer install --no-interaction --no-progress \
    && cd ../java && mvn --batch-mode package -DskipTests \
    && mvn --batch-mode dependency:build-classpath -Dmdep.outputFile=classpath.txt

# Reports are written to /app/results and should be mounted or copied out as a
# pipeline artifact; credentials are supplied at runtime via env vars/secrets,
# never baked into the image.
ENTRYPOINT ["node", "cli.js"]
CMD ["--urls-file", "endpoints.json"]
