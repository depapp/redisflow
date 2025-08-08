const { ioredisClient } = require('../config/redis');

async function flushAll() {
    console.log('\n⚠️  WARNING: This will delete ALL data from Redis!\n');
    console.log('=' .repeat(50));
    
    try {
        // Connect to Redis
        console.log('Connecting to Redis...');
        await ioredisClient.ping();
        console.log('✅ Connected to Redis\n');
        
        // Get current database size
        const dbSize = await ioredisClient.dbsize();
        console.log(`Current database has ${dbSize} keys\n`);
        
        if (dbSize === 0) {
            console.log('Database is already empty.');
            return;
        }
        
        // Flush all data
        console.log('Flushing all data...');
        await ioredisClient.flushall();
        
        // Verify
        const newDbSize = await ioredisClient.dbsize();
        
        console.log('\n✅ All data deleted!');
        console.log(`   - Deleted ${dbSize} keys`);
        console.log(`   - Database now has ${newDbSize} keys`);
        
    } catch (error) {
        console.error('❌ Error during flush:', error);
    } finally {
        await ioredisClient.quit();
        process.exit(0);
    }
}

// Run the flush
console.log('Starting complete Redis flush...');
flushAll();
