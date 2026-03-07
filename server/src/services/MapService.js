/**
 * MapService.js
 * Generates and serves political division boundary GeoJSON.
 *
 * Uses h3.cellsToMultiPolygon to dissolve the interior edges of a set of
 * H3 cells, producing a clean outer border for each Senorio (or any division).
 * No external GIS library needed — h3-js handles the merge natively.
 */

'use strict';

const h3 = require('h3-js');
const pool = require('../../db.js');
const DivisionModel = require('../models/DivisionModel.js');
const { Logger } = require('../utils/logger.js');

class MapService {

    /**
     * Pre-calculates the exterior boundary of a political division by merging
     * its H3 cells with h3.cellsToMultiPolygon (dissolves interior edges).
     * Saves the result as GeoJSON into political_divisions.boundary_geojson.
     *
     * Safe to call after COMMIT — uses pool directly, not a transaction client.
     * Never throws: logs errors silently so callers are unaffected.
     *
     * @param {number} divisionId
     */
    async generateDivisionBoundary(divisionId) {
        try {
            const cells = await DivisionModel.GetDivisionFiefs(pool, divisionId);

            if (cells.length === 0) {
                await DivisionModel.UpdateBoundary(pool, divisionId, null);
                return;
            }

            // cellsToMultiPolygon(cells, formatAsGeoJson=true) dissolves interior
            // edges and returns coordinates in [lng, lat] order (GeoJSON standard).
            // Result: number[][][] — array of polygons, each polygon is array of rings.
            const multiPolygonCoords = h3.cellsToMultiPolygon(cells, true);

            const geojson = {
                type: 'Feature',
                properties: { division_id: divisionId },
                geometry: {
                    type: 'MultiPolygon',
                    coordinates: multiPolygonCoords,
                },
            };

            await DivisionModel.UpdateBoundary(pool, divisionId, geojson);
            Logger.action(`[MapService] Boundary generated for division ${divisionId} (${cells.length} cells)`);
        } catch (err) {
            Logger.error(err, { fn: 'generateDivisionBoundary', divisionId });
        }
    }

    /**
     * GET /divisions/boundaries
     *
     * Returns a GeoJSON FeatureCollection of all division boundaries that have
     * been pre-calculated (boundary_geojson IS NOT NULL).
     *
     * Each Feature includes properties:
     *   division_id, name, player_id, capital_h3, territory_name
     *
     * Authentication: required (authenticateToken in route).
     */
    async GetAllBoundaries(req, res) {
        try {
            const rows = await DivisionModel.GetAllActiveBoundaries(pool);

            const features = rows.map(row => ({
                ...row.boundary_geojson,
                properties: {
                    division_id:    row.id,
                    name:           row.name,
                    player_id:      row.player_id,
                    capital_h3:     row.capital_h3,
                    territory_name: row.territory_name,
                },
            }));

            res.json({
                type: 'FeatureCollection',
                features,
            });
        } catch (err) {
            Logger.error(err, { endpoint: '/divisions/boundaries', method: 'GET' });
            res.status(500).json({ success: false, message: 'Error al obtener fronteras de divisiones' });
        }
    }
}

module.exports = new MapService();
