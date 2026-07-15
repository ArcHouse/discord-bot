FROM node:22

# Force rebuild v3 - fixed Russian encoding
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    make \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "index.js"]
