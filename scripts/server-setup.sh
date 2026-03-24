#!/bin/bash
# server-setup.sh — configuración inicial del VPS Hetzner (ejecutar una sola vez como root)
# Testado en Ubuntu 22.04 LTS

set -e

echo "=== 1. Actualizar sistema ==="
apt-get update && apt-get upgrade -y

echo "=== 2. Instalar Docker ==="
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "=== 3. Crear usuario deploy ==="
useradd -m -s /bin/bash deploy
usermod -aG docker deploy

echo "=== 4. Configurar clave SSH para deploy ==="
mkdir -p /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
# Pega aquí la clave pública (la parte .pub de tu par SSH para GitHub Actions)
echo "PEGA_AQUI_TU_CLAVE_PUBLICA_SSH" >> /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh

echo "=== 5. Clonar repositorio ==="
mkdir -p /opt/mediev-h3
chown deploy:deploy /opt/mediev-h3
sudo -u deploy git clone https://github.com/TU_USUARIO/TU_REPO.git /opt/mediev-h3

echo "=== 6. Crear .env de producción ==="
echo "Copia .env.example a /opt/mediev-h3/.env y rellena los valores reales:"
echo "  cp /opt/mediev-h3/.env.example /opt/mediev-h3/.env"
echo "  nano /opt/mediev-h3/.env"

echo ""
echo "=== Setup completado ==="
echo "Pasos manuales restantes:"
echo "  1. Rellenar /opt/mediev-h3/.env con los valores reales"
echo "  2. cd /opt/mediev-h3 && docker compose -f docker-compose.prod.yml up -d"
echo "  3. Esperar a que levante y ejecutar extractor.py contra el puerto 5444"
echo "  4. (Opcional) Cerrar el puerto 5444 en el firewall una vez cargado el mapa"
