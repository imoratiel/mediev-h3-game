Zonas asignadas:

Cultura	Zona principal
Celtas (4)	NW — Galicia, Asturias, Cantabria, N Portugal
Íberos (3)	E coast — Cataluña, Valencia, Murcia, Levante
Cartagineses (2)	S — Andalucía, Cartagena, S Portugal
Romanos (1)	Centro — Meseta, Extremadura + base residual (10pts) en todo el mapa
Lógica: cada hex recibe entre 1 y 4 entradas con pesos 0-100. Las zonas se solapan en los bordes para transiciones graduales.

Para ejecutarlo:


cd tools
python populate_geo_culture_weights.py --dry-run   # previsualizar
python populate_geo_culture_weights.py              # aplicar
Requiere h3 y psycopg2 instalados (pip install h3 psycopg2-binary).

