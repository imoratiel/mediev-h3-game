# Usamos la versión estable de Node
FROM node:18-alpine

# Carpeta de trabajo dentro del contenedor
WORKDIR /app

# Copiamos los archivos de dependencias del servidor
COPY package*.json ./

# Instalamos las librerías
RUN npm install

# Copiamos el resto del código del servidor
COPY . .

# Fallback vacío: el volumen de docker-compose monta el CHANGELOG.md real en runtime
RUN [ -f CHANGELOG.md ] || echo "# Changelog" > CHANGELOG.md

# Exponemos el puerto que usa tu app (ej. 3000)
EXPOSE 3000

# Comando para arrancar
CMD ["npm", "start"]
