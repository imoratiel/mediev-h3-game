# Sistema de Movimiento de Ejércitos

## 1. Puntos de Movimiento (PM)

Cada ejército tiene un número de PM disponibles por turno. El valor se calcula al inicio del procesamiento del turno:

```
PM = min(speed) de todas las unidades del ejército
```

- La velocidad (`speed`) es un atributo de cada tipo de unidad (`unit_types.speed`).
- El ejército se mueve a la velocidad de su unidad **más lenta**.
- Si alguna unidad tiene `force_rest = TRUE`, el ejército tiene **PM = 0** y no puede moverse ese turno.

**Máximo de hexágonos por turno:** 4 (independientemente de los PM disponibles).

---

## 2. Costes de Terreno

Cada hexágono tiene un coste de movimiento definido en `terrain_types.movement_cost`:

| Terreno       | Coste |
|---------------|-------|
| Llanura       | 1.0   |
| Costa         | 1.0   |
| Bosque        | 1.5   |
| Río           | 1.5   |
| Colinas       | 2.0   |
| Pantano       | 3.0   |
| Montaña       | 4.0   |
| Mar           | -1 (infranqueable) |

El coste mínimo aplicado es siempre 1, aunque el valor del terreno sea menor.

---

## 3. Elección de Ruta (Algoritmo A*)

La ruta se calcula mediante **A\*** usando la rejilla H3 como grafo.

### Funcionamiento

1. Se parte del hexágono actual del ejército hacia el destino.
2. Para cada hexágono evaluado se consulta su coste de terreno (con caché en memoria durante el cálculo).
3. La **heurística** es la distancia de rejilla H3: `h3.gridDistance(hex, destino)` — es admisible porque es el mínimo de saltos posibles.
4. La puntuación de cada nodo es `f = g + h`, donde:
   - `g` = coste acumulado desde el origen
   - `h` = distancia H3 al destino
5. Los hexágonos con `movement_cost < 0` (mar) son **ignorados** (infranqueables).
6. El algoritmo explora hasta un máximo de **15.000 nodos** para evitar bloqueos en mapas grandes.

La ruta calculada se almacena como un array JSON en `army_routes.path` y se reutiliza turno a turno hasta que el ejército llega o recibe nuevas órdenes.

---

## 4. Ejecución del Movimiento por Turno

Cada turno, el motor procesa cada ejército con destino asignado:

```
1. Si recovering > 0 → bloqueado, no mueve
2. Si alguna tropa tiene force_rest → PM = 0, no mueve
3. Cargar ruta desde army_routes.path
4. Mientras (PM > 0) y (hay ruta) y (pasos < 4):
   a. Coger siguiente hexágono de la ruta
   b. Si PM >= coste del terreno:
        - Restar coste de PM
        - Consumir stamina a las tropas (ver §5)
        - Mover ejército al hexágono
   c. Si PM < coste (esfuerzo extra):
        - Mover igualmente el hexágono
        - Descontar stamina por coste del terreno (igual que paso normal)
        - Si alguna tropa llega a stamina = 0 → force_rest = TRUE en esa tropa
        - recovering = 1 (turno de descanso forzado)
        - Detener el bucle
5. Si llegó al destino: limpiar destino y ruta
```

---

## 5. Cansancio (Stamina)

Cada tropa (`troops`) tiene un valor individual de `stamina` en el rango **0–100**.

### Consumo por movimiento

Al moverse a un hexágono, cada tropa pierde stamina igual al coste de movimiento del terreno:

```
nueva_stamina = max(0, stamina_actual - movement_cost_terreno)
```

Si la stamina llega a **0**, la tropa entra en `force_rest = TRUE` automáticamente.

### Esfuerzo extra

Si el ejército no tiene suficientes PM para el siguiente hexágono pero aún queda ruta, puede hacer un **esfuerzo extra**:
- Se mueve de todas formas al hexágono.
- La stamina se descuenta con el coste normal del terreno (igual que cualquier otro paso). Si llega a 0, esa tropa entra en `force_rest = TRUE`.
- El ejército queda con `recovering = 1` (no puede moverse el siguiente turno).

### Recuperación pasiva

Cada turno (al final, después del movimiento), las tropas recuperan stamina:

```
nueva_stamina = min(100, stamina_actual + 4)
```

Si una tropa tenía `force_rest = TRUE` y su stamina alcanza **≥ 25**, se libera automáticamente (`force_rest = FALSE`).

### Resumen de constantes

| Parámetro                    | Valor |
|------------------------------|-------|
| Stamina máxima               | 100   |
| Recuperación por turno       | +4    |
| Umbral para liberar force_rest | 25  |
| Turnos de penalización (esfuerzo extra) | 1 |

---

## 6. Orden de Procesamiento en el Motor de Turnos

```
1. processArmyMovements()   — mueve todos los ejércitos con destino
2. processWorkerMovements() — mueve trabajadores
3. processArmyRecovery()    — recupera stamina y decrementa recovering
```

El movimiento ocurre **antes** de la recuperación para que el cansancio generado en el turno actual se recupere en el mismo turno (ciclo natural).

---

## 7. Tablas de Base de Datos Relevantes

| Tabla          | Columnas clave                                              |
|----------------|-------------------------------------------------------------|
| `armies`       | `h3_index`, `destination`, `recovering`                    |
| `army_routes`  | `army_id`, `path` (JSONB array de hexágonos)               |
| `troops`       | `army_id`, `stamina`, `force_rest`, `unit_type_id`         |
| `unit_types`   | `speed` (PM del tipo de unidad)                            |
| `terrain_types`| `movement_cost`                                            |
| `h3_map`       | `h3_index`, `terrain_type_id`                              |
