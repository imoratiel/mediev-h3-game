# Usamos la versión estable de Node
FROM node:18

# Carpeta de trabajo dentro del contenedor
WORKDIR /app

# Copiamos los archivos de dependencias
COPY package*.json ./

# Instalamos las librerías
RUN npm install

# Copiamos el resto del código
COPY . .

# Exponemos el puerto que usa tu app (ej. 3000)
EXPOSE 3000

# Comando para arrancar
CMD ["npm", "start"]