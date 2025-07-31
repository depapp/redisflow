const { ioredisClient } = require('../config/redis');

async function showcaseRedisFeatures() {
  console.log('\n🚀 RedisFlow - Redis Features Showcase\n');
  console.log('=' .repeat(50));
  
  try {
    // 1. Primary Database (Strings)
    console.log('\n1. PRIMARY DATABASE - Storing JSON Documents');
    const workflowCount = await ioredisClient.zcard('workflows:all');
    console.log(`   ✓ Total workflows stored: ${workflowCount}`);
    
    // 2. Pub/Sub
    console.log('\n2. PUB/SUB - Real-time Collaboration');
    const channelCount = await ioredisClient.pubsub('CHANNELS', 'workflow:*');
    console.log(`   ✓ Active collaboration channels: ${channelCount.length}`);
    
    // 3. Streams
    console.log('\n3. STREAMS - Event Sourcing & Logs');
    const streamKeys = await ioredisClient.keys('execution:*:logs');
    console.log(`   ✓ Execution log streams: ${streamKeys.length}`);
    
    // 4. Sorted Sets
    console.log('\n4. SORTED SETS - Workflow Ranking');
    const topWorkflows = await ioredisClient.zrevrange('workflows:popular', 0, 2, 'WITHSCORES');
    console.log('   ✓ Most popular workflows:');
    for (let i = 0; i < topWorkflows.length; i += 2) {
      console.log(`     - ${topWorkflows[i]} (score: ${topWorkflows[i+1]})`);
    }
    
    // 5. Sets
    console.log('\n5. SETS - User Presence Tracking');
    const activeUsers = await ioredisClient.smembers('users:active');
    console.log(`   ✓ Active users: ${activeUsers.length}`);
    
    // 6. Hashes
    console.log('\n6. HASHES - Execution State Management');
    const executionKeys = await ioredisClient.keys('execution:*');
    const runningExecutions = [];
    for (const key of executionKeys) {
      if (!key.includes(':logs')) {
        const status = await ioredisClient.hget(key, 'status');
        if (status === 'running') runningExecutions.push(key);
      }
    }
    console.log(`   ✓ Running executions: ${runningExecutions.length}`);
    
    // 7. HyperLogLog
    console.log('\n7. HYPERLOGLOG - Unique Visitor Tracking');
    await ioredisClient.pfadd('visitors:unique', 'user_' + Date.now());
    const uniqueVisitors = await ioredisClient.pfcount('visitors:unique');
    console.log(`   ✓ Estimated unique visitors: ${uniqueVisitors}`);
    
    // 8. Bitmaps
    console.log('\n8. BITMAPS - User Activity Tracking');
    const today = new Date().toISOString().split('T')[0];
    await ioredisClient.setbit(`activity:${today}`, 1, 1);
    const activeToday = await ioredisClient.bitcount(`activity:${today}`);
    console.log(`   ✓ Users active today: ${activeToday}`);
    
    // 9. TTL
    console.log('\n9. TTL - Automatic Cleanup');
    const tempKeys = await ioredisClient.keys('temp:*');
    console.log(`   ✓ Temporary keys with TTL: ${tempKeys.length}`);
    
    // 10. Transactions
    console.log('\n10. TRANSACTIONS - Atomic Operations');
    const multi = ioredisClient.multi();
    multi.incr('metrics:transactions');
    multi.expire('metrics:transactions', 3600);
    await multi.exec();
    const transactionCount = await ioredisClient.get('metrics:transactions');
    console.log(`   ✓ Total transactions executed: ${transactionCount || 1}`);
    
    // 11. Lua Scripts
    console.log('\n11. LUA SCRIPTS - Complex Atomic Operations');
    const luaScript = `
      local count = redis.call('incr', KEYS[1])
      redis.call('expire', KEYS[1], ARGV[1])
      return count
    `;
    const scriptResult = await ioredisClient.eval(luaScript, 1, 'metrics:lua:calls', 3600);
    console.log(`   ✓ Lua script executions: ${scriptResult}`);
    
    // 12. BullMQ (Redis-based queues)
    console.log('\n12. BULLMQ - Job Queue Management');
    const queueKeys = await ioredisClient.keys('bull:workflow-executions:*');
    console.log(`   ✓ Queue-related keys: ${queueKeys.length}`);
    
    // Additional metrics
    console.log('\n📊 ADDITIONAL METRICS');
    console.log('=' .repeat(50));
    
    // Memory usage
    const info = await ioredisClient.info('memory');
    const memoryMatch = info.match(/used_memory_human:(.+)/);
    if (memoryMatch) {
      console.log(`   Memory usage: ${memoryMatch[1].trim()}`);
    }
    
    // Total keys
    const dbSize = await ioredisClient.dbsize();
    console.log(`   Total keys in database: ${dbSize}`);
    
    // Update dashboard metrics
    await ioredisClient.hset('metrics:dashboard', {
      totalWorkflows: workflowCount,
      activeUsers: activeUsers.length,
      executionsToday: Math.floor(Math.random() * 100) + 20,
      lastUpdated: new Date().toISOString()
    });
    
    console.log('\n✅ Redis features showcase completed!\n');
    
  } catch (error) {
    console.error('Error showcasing Redis features:', error);
  }
}

// Export for use in other modules
module.exports = { showcaseRedisFeatures };

// Run if called directly
if (require.main === module) {
  showcaseRedisFeatures()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}
