/**
 * Graceful Shutdown Handler
 * Ensures SSE connections are properly closed and cleanup happens before exit
 */

const { createLogger } = require('./logger');
const logger = createLogger({ component: 'shutdown' });

// Track all active SSE connections
const activeConnections = new Set();
let isShuttingDown = false;

/**
 * Register an SSE response for graceful shutdown
 */
function registerConnection(res, metadata = {}) {
  const connection = {
    res,
    metadata,
    createdAt: Date.now()
  };

  activeConnections.add(connection);

  // Auto-cleanup when response ends
  res.on('close', () => {
    activeConnections.delete(connection);
  });

  return connection;
}

/**
 * Close all active SSE connections gracefully
 */
async function closeAllConnections(timeout = 5000) {
  logger.info('Closing all SSE connections', {
    count: activeConnections.size
  });

  const connections = Array.from(activeConnections);
  const startTime = Date.now();

  // Send shutdown notification to all clients
  for (const conn of connections) {
    try {
      // Send final event to clients
      conn.res.write(`event: shutdown\ndata: ${JSON.stringify({
        message: 'Server is restarting. Please reconnect in a moment.',
        timestamp: new Date().toISOString()
      })}\n\n`);

      // Close the connection
      conn.res.end();
    } catch (error) {
      logger.error('Error closing connection', {
        error: error.message,
        metadata: conn.metadata
      });
    }
  }

  // Wait for all connections to close or timeout
  const waitForClose = new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      if (activeConnections.size === 0 || Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 100);
  });

  await waitForClose;

  const remainingConnections = activeConnections.size;
  if (remainingConnections > 0) {
    logger.warn('Some connections did not close gracefully', {
      remaining: remainingConnections,
      timeout
    });
  } else {
    logger.info('All SSE connections closed successfully');
  }

  return {
    closed: connections.length - remainingConnections,
    remaining: remainingConnections
  };
}

/**
 * Setup graceful shutdown handlers
 */
function setupGracefulShutdown(server, options = {}) {
  const {
    timeout = 30000, // 30 seconds total shutdown timeout
    sseTimeout = 5000 // 5 seconds for SSE cleanup
  } = options;

  const shutdown = async (signal) => {
    if (isShuttingDown) {
      logger.warn('Shutdown already in progress, forcing exit');
      process.exit(1);
    }

    isShuttingDown = true;
    logger.info(`Received ${signal}, starting graceful shutdown`);

    // Step 1: Stop accepting new connections
    server.close(() => {
      logger.info('HTTP server closed - no longer accepting connections');
    });

    // Step 2: Close all SSE connections
    try {
      await closeAllConnections(sseTimeout);
    } catch (error) {
      logger.error('Error during SSE cleanup', { error: error.message });
    }

    // Step 3: Give other cleanup a chance to complete
    setTimeout(() => {
      logger.info('Graceful shutdown complete');
      process.exit(0);
    }, 1000);

    // Step 4: Force exit if shutdown takes too long
    setTimeout(() => {
      logger.error('Graceful shutdown timeout, forcing exit');
      process.exit(1);
    }, timeout);
  };

  // Handle different termination signals
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', {
      error: error.message,
      stack: error.stack
    });
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection', {
      reason: reason instanceof Error ? reason.message : reason,
      stack: reason instanceof Error ? reason.stack : undefined
    });
    // Don't shutdown on unhandled rejection - just log
  });

  logger.info('Graceful shutdown handlers registered');
}

/**
 * Check if server is shutting down
 */
function isServerShuttingDown() {
  return isShuttingDown;
}

/**
 * Get active connection count
 */
function getActiveConnectionCount() {
  return activeConnections.size;
}

module.exports = {
  registerConnection,
  closeAllConnections,
  setupGracefulShutdown,
  isServerShuttingDown,
  getActiveConnectionCount
};
