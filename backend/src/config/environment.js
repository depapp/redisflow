// Environment configuration
const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

// Feature flags
const ENABLE_DEMO_DATA = process.env.ENABLE_DEMO_DATA === 'true' || (!isProduction && process.env.ENABLE_DEMO_DATA !== 'false');
const ENABLE_AUTO_SEED = process.env.ENABLE_AUTO_SEED === 'true' && !isProduction;
const REDIS_EVICTION_MONITORING = process.env.REDIS_EVICTION_MONITORING !== 'false';

module.exports = {
    isDevelopment,
    isProduction,
    isTest,
    features: {
        enableDemoData: ENABLE_DEMO_DATA,
        enableAutoSeed: ENABLE_AUTO_SEED,
        redisEvictionMonitoring: REDIS_EVICTION_MONITORING
    },
    redis: {
        maxMemoryWarningThreshold: parseFloat(process.env.REDIS_MEMORY_WARNING_THRESHOLD || '0.8'), // 80% of max memory
    }
};
