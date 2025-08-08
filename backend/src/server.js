const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { connectRedis, ioredisClient, monitorRedisMemory } = require('./config/redis');
const { features, isProduction } = require('./config/environment');
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

// Add Vercel preview URLs pattern
const vercelPreviewPattern = /^https:\/\/redisflow-.*\.vercel\.app$/;

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        // Check if origin is in allowed list
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } 
        // Check if it's a Vercel preview URL
        else if (vercelPreviewPattern.test(origin)) {
            callback(null, true);
        }
        // Always allow the main Vercel URL
        else if (origin === 'https://redisflow.vercel.app') {
            callback(null, true);
        }
        else {
            console.log('CORS blocked origin:', origin);
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
        
        // Get memory info
        const info = await ioredisClient.info('memory');
        const usedMemory = parseInt(info.match(/used_memory:(\d+)/)?.[1] || 0);
        const maxMemory = parseInt(info.match(/maxmemory:(\d+)/)?.[1] || 0);
        const evictedKeys = parseInt(info.match(/evicted_keys:(\d+)/)?.[1] || 0);
        
        res.json({
            status: 'healthy',
            redis: ping === 'PONG',
            timestamp: new Date().toISOString(),
            connections: io.engine.clientsCount || 0,
            memory: {
                used: usedMemory,
                max: maxMemory,
                usagePercent: maxMemory > 0 ? ((usedMemory / maxMemory) * 100).toFixed(2) : 0,
                evictedKeys
            },
            environment: process.env.NODE_ENV || 'development'
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});

// Redis monitoring endpoint (protected)
app.get('/api/redis/monitor', async (req, res) => {
    try {
        const info = await ioredisClient.info();
        const dbSize = await ioredisClient.dbsize();
        
        // Parse memory info
        const memoryInfo = {};
        const memorySection = info.match(/# Memory\n([\s\S]*?)(?=\n# |$)/)?.[1] || '';
        memorySection.split('\n').forEach(line => {
            const [key, value] = line.split(':');
            if (key && value) {
                memoryInfo[key] = value.trim();
            }
        });
        
        // Get workflow statistics
        const workflowKeys = await ioredisClient.keys('workflow:*');
        const actualWorkflows = workflowKeys.filter(key => key.match(/^workflow:[a-f0-9-]+$/));
        
        res.json({
            dbSize,
            workflowCount: actualWorkflows.length,
            memory: memoryInfo,
            evictionWarning: parseInt(memoryInfo.evicted_keys || 0) > 0,
            environment: {
                nodeEnv: process.env.NODE_ENV,
                features: features
            }
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to get Redis monitoring data',
            message: error.message
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
        
        // Log environment configuration
        console.log(`🔧 Configuration:`);
        console.log(`   - Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`   - Demo Data: ${features.enableDemoData ? 'enabled' : 'disabled'}`);
        console.log(`   - Auto Seed: ${features.enableAutoSeed ? 'enabled' : 'disabled'}`);
        console.log(`   - Redis Monitoring: ${features.redisEvictionMonitoring ? 'enabled' : 'disabled'}`);
        
        // Set up periodic memory monitoring in production
        if (isProduction && features.redisEvictionMonitoring) {
            setInterval(async () => {
                await monitorRedisMemory();
            }, 60000); // Check every minute
        }
        
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
