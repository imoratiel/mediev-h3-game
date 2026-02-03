/**
 * Integration Tests for Game API Endpoints
 * Tests: /api/map/region, /api/map/cell-details, /api/game/claim
 */

// Mock the database before importing the app
jest.mock('../../db');

const request = require('supertest');
const app = require('../../index');
const pool = require('../../db');

describe('GET /api/map/region', () => {
  beforeEach(() => {
    // Reset mocks before each test
    if (pool.resetMocks) pool.resetMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('debería devolver status 200 y un array de celdas con datos válidos', async () => {
    // Mock data: array of hexagons from the view
    // h3_index is stored as TEXT (hexadecimal string)
    const mockHexagons = [
      {
        h3_index: '88185ba635fffff', // Hexadecimal string
        terrain_type_id: 6,
        terrain_color: '#7db35d',
        terrain_name: 'Tierras de Cultivo',
        has_road: false,
        player_id: null,
        player_color: null,
        owner_name: null,
        building_type_id: null,
        icon_slug: null,
        is_capital: false,
        location_name: null,
        settlement_type: null,
        population_rank: null
      },
      {
        h3_index: '88185ba44dfffff', // Hexadecimal string
        terrain_type_id: 1,
        terrain_color: '#0a4b78',
        terrain_name: 'Mar',
        has_road: false,
        player_id: 1,
        player_color: '#ff5722',
        owner_name: 'Neutral',
        building_type_id: null,
        icon_slug: null,
        is_capital: true,
        location_name: 'Capital',
        settlement_type: null,
        population_rank: null
      }
    ];

    // The endpoint makes only ONE query to the view
    pool.query.mockResolvedValueOnce({ rows: mockHexagons });

    const response = await request(app)
      .get('/api/map/region')
      .query({
        minLat: 43.41,
        maxLat: 43.57,
        minLng: -5.79,
        maxLng: -5.63,
        res: 8
      });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(2);
  });

  it('debería devolver h3_index como String, no como BigInt', async () => {
    const mockHexagons = [
      {
        h3_index: '88185ba635fffff', // Hexadecimal string
        terrain_type_id: 6,
        terrain_color: '#7db35d',
        terrain_name: 'Tierras de Cultivo',
        has_road: false,
        player_id: null,
        player_color: null,
        owner_name: null,
        building_type_id: null,
        icon_slug: null,
        is_capital: false,
        location_name: null,
        settlement_type: null,
        population_rank: null
      }
    ];

    pool.query.mockResolvedValueOnce({ rows: mockHexagons });

    const response = await request(app)
      .get('/api/map/region')
      .query({
        minLat: 43.41,
        maxLat: 43.57,
        minLng: -5.79,
        maxLng: -5.63,
        res: 8
      });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(typeof response.body[0].h3_index).toBe('string');
    // h3_index is stored as hexadecimal string
    expect(response.body[0].h3_index).toMatch(/^[0-9a-f]+$/);
  });

  it('debería rechazar la petición si faltan parámetros obligatorios', async () => {
    const response = await request(app)
      .get('/api/map/region')
      .query({
        minLat: 43.41,
        // Missing other required params
      });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('message');
    expect(response.body.message).toMatch(/required|missing/i);
  });

  it('debería manejar errores de base de datos correctamente', async () => {
    // Simulate database error
    pool.query.mockRejectedValueOnce(new Error('Database connection failed'));

    const response = await request(app)
      .get('/api/map/region')
      .query({
        minLat: 43.41,
        maxLat: 43.57,
        minLng: -5.79,
        maxLng: -5.63,
        res: 8
      });

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty('error');
    expect(response.body).toHaveProperty('message');
  });
});

describe('GET /api/map/cell-details/:h3_index', () => {
  beforeEach(() => {
    if (pool.resetMocks) pool.resetMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('debería devolver status 200 y detalles completos para una celda existente con dueño', async () => {
    const mockCellData = {
      h3_index: '618318123583045631',
      terrain_type: 'Tierras de Cultivo',
      terrain_color: '#7db35d',
      player_id: 1,
      player_name: 'Neutral',
      player_color: '#ff5722',
      building_type: null,
      is_capital: true,
      settlement_name: 'Capital Real',
      settlement_type: null,
      population: 350,
      happiness: 65,
      food_stored: 1500,
      wood_stored: 800,
      stone_stored: 400,
      iron_stored: 200
    };

    pool.query.mockResolvedValueOnce({ rows: [mockCellData] });

    const response = await request(app)
      .get('/api/map/cell-details/88185ba635fffff');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('h3_index', '88185ba635fffff');
    expect(response.body).toHaveProperty('terrain_type', 'Tierras de Cultivo');
    expect(response.body).toHaveProperty('player_name', 'Neutral');
    expect(response.body).toHaveProperty('territory');
    expect(response.body.territory).toHaveProperty('population', 350);
    expect(response.body.territory).toHaveProperty('food', 1500);
  });

  it('debería devolver status 404 para una celda inexistente', async () => {
    // Mock empty result (cell not found)
    pool.query.mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .get('/api/map/cell-details/88185ba635fffff');

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('success', false);
    expect(response.body).toHaveProperty('message');
  });

  it('debería devolver territory null para celdas sin dueño', async () => {
    const mockCellData = {
      h3_index: '618318123583045631',
      terrain_type: 'Bosque',
      terrain_color: '#558b2f',
      player_id: null,
      player_name: null,
      player_color: null,
      building_type: null,
      is_capital: false,
      settlement_name: null,
      settlement_type: null,
      population: null,
      happiness: null,
      food_stored: null,
      wood_stored: null,
      stone_stored: null,
      iron_stored: null
    };

    pool.query.mockResolvedValueOnce({ rows: [mockCellData] });

    const response = await request(app)
      .get('/api/map/cell-details/88185ba44dfffff');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('terrain_type', 'Bosque');
    expect(response.body).toHaveProperty('player_id', null);
    expect(response.body.territory).toBeNull();
  });

  it('debería manejar errores de base de datos correctamente', async () => {
    pool.query.mockRejectedValueOnce(new Error('Query failed'));

    const response = await request(app)
      .get('/api/map/cell-details/88185ba635fffff');

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty('success', false);
  });
});

describe('POST /api/game/claim', () => {
  beforeEach(() => {
    if (pool.resetMocks) pool.resetMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('debería colonizar exitosamente la primera celda (caso feliz - primer territorio)', async () => {
    const mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    // Correct order according to actual endpoint flow:
    // 1. BEGIN
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    // 2. Territory count query - returns 0 (first territory)
    mockClient.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    // 3. Hex query - check terrain and ownership
    mockClient.query.mockResolvedValueOnce({
      rows: [{
        h3_index: '88185ba635fffff',
        player_id: null,
        terrain_type_id: 6,
        iron_output: 0,
        terrain_name: 'Tierras de Cultivo'
      }]
    });

    // 4. Player query - check gold balance
    mockClient.query.mockResolvedValueOnce({
      rows: [{ player_id: 1, username: 'Neutral', gold: 50000 }]
    });

    // 5. UPDATE h3_map - set ownership
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    // 6. INSERT territory_details
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    // 7. UPDATE players - deduct gold
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    // 8. SELECT new gold balance
    mockClient.query.mockResolvedValueOnce({
      rows: [{ gold: 49900 }]
    });

    // 9. COMMIT
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    pool.connect.mockResolvedValueOnce(mockClient);

    const response = await request(app)
      .post('/api/game/claim')
      .send({
        player_id: 1,
        h3_index: '88185ba635fffff'
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('success', true);
    expect(response.body).toHaveProperty('new_gold_balance');
    expect(response.body.new_gold_balance).toBe(49900);
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('debería rechazar la colonización si el jugador no tiene suficiente oro', async () => {
    const mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    // 1. BEGIN
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    // 2. Territory count query
    mockClient.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    // 3. Hex query - valid terrain, not owned
    mockClient.query.mockResolvedValueOnce({
      rows: [{
        h3_index: '88185ba635fffff',
        player_id: null,
        terrain_type_id: 6,
        iron_output: 0,
        terrain_name: 'Tierras de Cultivo'
      }]
    });

    // 4. Player gold check (NOT ENOUGH gold)
    mockClient.query.mockResolvedValueOnce({
      rows: [{ player_id: 1, username: 'Neutral', gold: 50 }] // Only 50 gold
    });

    // 5. ROLLBACK
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    pool.connect.mockResolvedValueOnce(mockClient);

    const response = await request(app)
      .post('/api/game/claim')
      .send({
        player_id: 1,
        h3_index: '88185ba635fffff'
      });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('success', false);
    expect(response.body.message).toMatch(/oro|gold/i);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('debería rechazar la colonización de celdas de Mar (terrain_type_id = 1)', async () => {
    const mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    // 1. BEGIN
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    // 2. Territory count query
    mockClient.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    // 3. Hex query - SEA terrain (terrain_type_id = 1)
    mockClient.query.mockResolvedValueOnce({
      rows: [{
        h3_index: '88185ba635fffff',
        player_id: null,
        terrain_type_id: 1,
        iron_output: 0,
        terrain_name: 'Mar'
      }]
    });

    // 4. ROLLBACK (endpoint rejects after terrain check)
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    pool.connect.mockResolvedValueOnce(mockClient);

    const response = await request(app)
      .post('/api/game/claim')
      .send({
        player_id: 1,
        h3_index: '88185ba635fffff'
      });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('success', false);
    expect(response.body.message).toMatch(/mar|sea|agua|water/i);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('debería rechazar la colonización de celdas de Agua (terrain_type_id = 3)', async () => {
    const mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    // 1. BEGIN
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    // 2. Territory count query
    mockClient.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    // 3. Hex query - WATER terrain (terrain_type_id = 3)
    mockClient.query.mockResolvedValueOnce({
      rows: [{
        h3_index: '88185ba44dfffff',
        player_id: null,
        terrain_type_id: 3,
        iron_output: 0,
        terrain_name: 'Agua'
      }]
    });

    // 4. ROLLBACK (endpoint rejects after terrain check)
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    pool.connect.mockResolvedValueOnce(mockClient);

    const response = await request(app)
      .post('/api/game/claim')
      .send({
        player_id: 1,
        h3_index: '88185ba44dfffff'
      });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('success', false);
    expect(response.body.message).toMatch(/mar|sea|agua|water/i);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('debería rechazar celdas no contiguas cuando el jugador ya tiene territorios', async () => {
    const mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    // 1. BEGIN
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    // 2. Territory count (already has 2 territories)
    mockClient.query.mockResolvedValueOnce({ rows: [{ count: '2' }] });

    // 3. Hex query - valid terrain, not owned
    mockClient.query.mockResolvedValueOnce({
      rows: [{
        h3_index: '88185ba635fffff',
        player_id: null,
        terrain_type_id: 6,
        iron_output: 0,
        terrain_name: 'Tierras de Cultivo'
      }]
    });

    // 4. Player gold check (enough gold)
    mockClient.query.mockResolvedValueOnce({
      rows: [{ player_id: 1, username: 'Neutral', gold: 50000 }]
    });

    // 5. Adjacent territories check (NO adjacent territories found - count = 0)
    mockClient.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    // 6. ROLLBACK
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    pool.connect.mockResolvedValueOnce(mockClient);

    const response = await request(app)
      .post('/api/game/claim')
      .send({
        player_id: 1,
        h3_index: '88185ba635fffff'
      });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('success', false);
    expect(response.body.message).toMatch(/contig|adyacente|adjacent/i);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('debería rechazar celdas ya ocupadas por otro jugador', async () => {
    const mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    // BEGIN
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    // Terrain check
    mockClient.query.mockResolvedValueOnce({
      rows: [{ terrain_type_id: 6, terrain_name: 'Tierras de Cultivo' }]
    });

    // Ownership check (ALREADY OWNED by player 2)
    mockClient.query.mockResolvedValueOnce({
      rows: [{ player_id: 2, username: 'OtherPlayer' }]
    });

    // ROLLBACK
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    pool.connect.mockResolvedValueOnce(mockClient);

    const response = await request(app)
      .post('/api/game/claim')
      .send({
        player_id: 1,
        h3_index: '88185ba635fffff'
      });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('success', false);
    expect(response.body.message).toMatch(/ocupad|owned|reclamad/i);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('debería rechazar peticiones sin player_id o h3_index', async () => {
    const response1 = await request(app)
      .post('/api/game/claim')
      .send({
        // Missing player_id
        h3_index: '88185ba635fffff'
      });

    expect(response1.status).toBe(400);
    expect(response1.body).toHaveProperty('success', false);

    const response2 = await request(app)
      .post('/api/game/claim')
      .send({
        player_id: 1
        // Missing h3_index
      });

    expect(response2.status).toBe(400);
    expect(response2.body).toHaveProperty('success', false);
  });

  it('debería establecer is_capital=true para el primer territorio', async () => {
    const mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    // 1. BEGIN
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    // 2. Territory count (0 = first)
    mockClient.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    // 3. Hex query - valid terrain, not owned
    mockClient.query.mockResolvedValueOnce({
      rows: [{
        h3_index: '88185ba635fffff',
        player_id: null,
        terrain_type_id: 6,
        iron_output: 0,
        terrain_name: 'Tierras de Cultivo'
      }]
    });

    // 4. Player gold check
    mockClient.query.mockResolvedValueOnce({
      rows: [{ player_id: 1, username: 'Neutral', gold: 50000 }]
    });

    // 5. Update h3_map - verify is_capital is set
    mockClient.query.mockImplementationOnce((query, params) => {
      expect(query).toMatch(/is_capital/i);
      expect(params[1]).toBe(true); // Second param (0-indexed) should be is_capital = true
      return Promise.resolve({ rows: [] });
    });

    // 6. Insert territory_details
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    // 7. Update players gold
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    // 8. COMMIT
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    pool.connect.mockResolvedValueOnce(mockClient);

    const response = await request(app)
      .post('/api/game/claim')
      .send({
        player_id: 1,
        h3_index: '88185ba635fffff'
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('success', true);
  });
});

describe('GET /health', () => {
  it('debería devolver status 200 y estado OK', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'ok');
    expect(response.body).toHaveProperty('timestamp');
  });
});
