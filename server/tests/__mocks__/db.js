/**
 * Mock Database Connection Pool
 * Simulates pg.Pool behavior for testing without hitting the real database
 */

const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockRelease = jest.fn();

// Mock client object returned by pool.connect()
const mockClient = {
  query: mockQuery,
  release: mockRelease,
};

// Mock pool object
const pool = {
  query: mockQuery,
  connect: jest.fn(() => Promise.resolve(mockClient)),
  end: jest.fn(() => Promise.resolve()),
  on: jest.fn(), // For event listeners
};

// Helper to reset all mocks between tests
pool.resetMocks = () => {
  mockQuery.mockReset();
  mockConnect.mockReset();
  mockRelease.mockReset();
  pool.connect.mockReset();
  pool.end.mockReset();
  pool.on.mockReset();
};

module.exports = pool;
