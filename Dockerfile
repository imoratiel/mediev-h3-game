# Dockerfile para Railway (contexto: raíz del repositorio)
# El Dockerfile de server/ se mantiene para docker-compose local
FROM node:18-alpine

WORKDIR /app

# Copiar dependencias desde la subcarpeta server/
COPY server/package*.json ./

RUN npm install --omit=dev

# Copiar el código del servidor
COPY server/ .

EXPOSE 3000

CMD ["node", "index.js"]
