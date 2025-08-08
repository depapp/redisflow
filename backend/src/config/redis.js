const { createClient } = require('redis');
const Redis = require('ioredis');
const { features, isProduction } = require('./environment');

// Load environment variables
require('dotenv').config();

// Redis configuration from environment variables
const redisConfig = {
    username: process.env.REDIS_USERNAME || 'default',
    password: process.env.REDIS_PASSWORD,
    socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        tls: process.env.REDIS_TLS === 'true' ? {
            rejectUnauthorized: false,
            servername: process.env.REDIS_HOST
        } : undefined
    }
};

// Validate required environment variables
if (!process.env.REDIS_PASSWORD) {
    console.error('❌ REDIS_PASSWORD environment variable is required');
    console.error('Please create a .env file based on .env.example');
    process.exit(1);
}

// Create Redis client for general use
const redisClient = createClient(redisConfig);

// Create ioredis client for advanced features (pub/sub, streams)
const ioredisConfig = {
    host: redisConfig.socket.host,
    port: redisConfig.socket.port,
    username: redisConfig.username,
    password: redisConfig.password,
    maxRetriesPerRequest: null, // Required for BullMQ
    retryStrategy: (times) => {
        const maxRetries = parseInt(process.env.REDIS_MAX_RETRIES || '3');
        if (times > maxRetries) {
            console.error(`❌ Redis connection failed after ${maxRetries} attempts`);
            return null;
        }
        const delay = Math.min(times * 50, 2000);
        return delay;
    }
};

// Add TLS configuration for Redis Cloud
if (process.env.REDIS_TLS === 'true') {
    ioredisConfig.tls = {
        rejectUnauthorized: false,
        servername: redisConfig.socket.host
    };
}

const ioredisClient = new Redis(ioredisConfig);

// Error handling
redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err);
});

ioredisClient.on('error', (err) => {
    console.error('IORedis Client Error:', err);
});

// Connect function
async function connectRedis() {
    try {
        await redisClient.connect();
        console.log('✅ Connected to Redis');
        console.log(`📍 Redis Host: ${redisConfig.socket.host}:${redisConfig.socket.port}`);
        
        // Test connection
        await redisClient.ping();
        console.log('✅ Redis connection verified');
        
        // Check eviction policy
        const config = await redisClient.configGet('maxmemory-policy');
        const evictionPolicy = config['maxmemory-policy'];
        if (evictionPolicy && evictionPolicy !== 'noeviction') {
            console.log(`⚠️  WARNING: Redis eviction policy is '${evictionPolicy}'. Consider setting it to 'noeviction' for production.`);
            
            // In production, this is critical
            if (isProduction) {
                console.error(`❌ CRITICAL: Production Redis has eviction policy '${evictionPolicy}' which may cause data loss!`);
            }
        }
        
        // Monitor memory usage if enabled
        if (features.redisEvictionMonitoring) {
            await monitorRedisMemory();
        }
    } catch (error) {
        console.error('❌ Failed to connect to Redis:', error);
        process.exit(1);
    }
}

// Monitor Redis memory usage
async function monitorRedisMemory() {
    try {
        const info = await ioredisClient.info('memory');
        const usedMemory = parseInt(info.match(/used_memory:(\d+)/)?.[1] || 0);
        const maxMemory = parseInt(info.match(/maxmemory:(\d+)/)?.[1] || 0);
        
        if (maxMemory > 0) {
            const usagePercent = (usedMemory / maxMemory) * 100;
            console.log(`📊 Redis Memory Usage: ${usagePercent.toFixed(2)}% (${(usedMemory / 1024 / 1024).toFixed(2)}MB / ${(maxMemory / 1024 / 1024).toFixed(2)}MB)`);
            
            if (usagePercent > 80) {
                console.warn(`⚠️  WARNING: Redis memory usage is above 80%! This may cause evictions.`);
            }
            
            if (usagePercent > 95) {
                console.error(`❌ CRITICAL: Redis memory usage is above 95%! Data loss imminent!`);
            }
        }
        
        // Log eviction stats
        const evictedKeys = parseInt(info.match(/evicted_keys:(\d+)/)?.[1] || 0);
        if (evictedKeys > 0) {
            console.error(`❌ ALERT: ${evictedKeys} keys have been evicted from Redis! This indicates memory pressure.`);
        }
    } catch (error) {
        console.error('Error monitoring Redis memory:', error);
    }
}

module.exports = {
    redisClient,
    ioredisClient,
    connectRedis,
    monitorRedisMemory,
    // Export duplicates for pub/sub
    createPubSubClient: () => ioredisClient.duplicate(),
    createSubscriber: () => ioredisClient.duplicate()
};
