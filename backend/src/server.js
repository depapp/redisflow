const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { connectRedis, ioredisClient } = require('./config/redis');
const workflowRoutes = require('./api/routes/workflow');
const executionRoutes = require('./api/routes/execution');
const statsRoutes = require('./api/routes/stats');
const { setupRealtimeHandlers } = require('./realtime/collaboration');

const app = express();
const httpServer = createServer(app);

// CORS configuration
const allowedOrigins = process.env.FRONTEND_URL 
    ? process.env.FRONTEND_URL.split(',').map(url => url.trim())
    : ['http://localhost:5173', 'http://localhost:3000'];

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// Socket.io setup
const io = new Server(httpServer, {
    cors: corsOptions,
    transports: ['websocket', 'polling']
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'RedisFlow Backend API',
        version: '1.0.0',
        status: 'running',
        endpoints: {
            health: '/health',
            workflows: '/api/workflows',
            executions: '/api/executions',
            stats: '/api/stats'
        }
    });
});

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        const ping = await ioredisClient.ping();
        res.json({
            status: 'healthy',
            redis: ping === 'PONG',
            timestamp: new Date().toISOString(),
            connections: io.engine.clientsCount || 0
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});

// API Routes
app.use('/api/workflows', workflowRoutes);
app.use('/api/executions', executionRoutes);
app.use('/api/stats', statsRoutes);

// Setup real-time collaboration handlers
setupRealtimeHandlers(io);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        error: err.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// Start server
const PORT = process.env.PORT || 3001;

async function startServer() {
    try {
        // Connect to Redis first
        await connectRedis();
        
        // Start HTTP server
        httpServer.listen(PORT, () => {
            console.log(`🚀 RedisFlow backend running on port ${PORT}`);
            console.log(`🔌 WebSocket server ready`);
            console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');
    
    // Close Socket.io connections
    io.close(() => {
        console.log('Socket.io connections closed');
    });
    
    // Close HTTP server
    httpServer.close(() => {
        console.log('HTTP server closed');
    });
    
    // Close Redis connections
    await ioredisClient.quit();
    
    process.exit(0);
});

// Start the server
startServer();

module.exports = { app, io };
