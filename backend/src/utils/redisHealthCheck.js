const { ioredisClient } = require('../config/redis');
const { isProduction } = require('../config/environment');

async function checkRedisHealth() {
    console.log('\n🔍 Redis Health Check\n');
    console.log('=' .repeat(50));
    
    try {
        // 1. Connection Test
        console.log('\n1. CONNECTION TEST');
        const ping = await ioredisClient.ping();
        console.log(`   ✓ Redis connection: ${ping === 'PONG' ? 'OK' : 'FAILED'}`);
        
        // 2. Memory Analysis
        console.log('\n2. MEMORY ANALYSIS');
        const info = await ioredisClient.info('memory');
        const usedMemory = parseInt(info.match(/used_memory:(\d+)/)?.[1] || 0);
        const usedMemoryHuman = info.match(/used_memory_human:(.+)/)?.[1]?.trim();
        const maxMemory = parseInt(info.match(/maxmemory:(\d+)/)?.[1] || 0);
        const maxMemoryHuman = maxMemory > 0 ? `${(maxMemory / 1024 / 1024).toFixed(2)}MB` : 'unlimited';
        const evictedKeys = parseInt(info.match(/evicted_keys:(\d+)/)?.[1] || 0);
        const evictionPolicy = info.match(/maxmemory_policy:(.+)/)?.[1]?.trim();
        
        console.log(`   Memory Used: ${usedMemoryHuman}`);
        console.log(`   Memory Limit: ${maxMemoryHuman}`);
        if (maxMemory > 0) {
            const usagePercent = (usedMemory / maxMemory) * 100;
            console.log(`   Memory Usage: ${usagePercent.toFixed(2)}%`);
            
            if (usagePercent > 90) {
                console.error(`   ❌ CRITICAL: Memory usage above 90%!`);
            } else if (usagePercent > 80) {
                console.warn(`   ⚠️  WARNING: Memory usage above 80%`);
            } else {
                console.log(`   ✓ Memory usage is healthy`);
            }
        }
        
        console.log(`   Eviction Policy: ${evictionPolicy || 'not set'}`);
        console.log(`   Evicted Keys: ${evictedKeys}`);
        
        if (evictedKeys > 0) {
            console.error(`   ❌ ALERT: ${evictedKeys} keys have been evicted!`);
            console.log(`   This means Redis has been removing data due to memory pressure.`);
        }
        
        // 3. Database Analysis
        console.log('\n3. DATABASE ANALYSIS');
        const dbSize = await ioredisClient.dbsize();
        console.log(`   Total Keys: ${dbSize}`);
        
        // Analyze key patterns
        const patterns = [
            { pattern: 'workflow:*', name: 'Workflows' },
            { pattern: 'execution:*', name: 'Executions' },
            { pattern: 'metrics:*', name: 'Metrics' },
            { pattern: 'temp:*', name: 'Temporary' },
            { pattern: 'user:*', name: 'Users' },
            { pattern: 'presence:*', name: 'Presence' },
            { pattern: 'history:*', name: 'History' }
        ];
        
        console.log('\n   Key Distribution:');
        for (const { pattern, name } of patterns) {
            const keys = await ioredisClient.keys(pattern);
            if (pattern === 'workflow:*') {
                // Filter actual workflows
                const actualWorkflows = keys.filter(key => key.match(/^workflow:[a-f0-9-]+$/));
                console.log(`   - ${name}: ${actualWorkflows.length} (total keys: ${keys.length})`);
            } else {
                console.log(`   - ${name}: ${keys.length}`);
            }
        }
        
        // 4. Workflow Analysis
        console.log('\n4. WORKFLOW ANALYSIS');
        const workflowKeys = await ioredisClient.keys('workflow:*');
        const actualWorkflows = workflowKeys.filter(key => key.match(/^workflow:[a-f0-9-]+$/));
        
        console.log(`   Total Workflows: ${actualWorkflows.length}`);
        
        // Check for demo workflows
        let demoCount = 0;
        let userWorkflows = [];
        
        for (const key of actualWorkflows) {
            const workflow = await ioredisClient.get(key);
            if (workflow) {
                const parsed = JSON.parse(workflow);
                if (parsed.userId === 'demo') {
                    demoCount++;
                } else {
                    userWorkflows.push({
                        id: parsed.id,
                        name: parsed.name,
                        userId: parsed.userId,
                        created: parsed.created
                    });
                }
            }
        }
        
        console.log(`   - Demo Workflows: ${demoCount}`);
        console.log(`   - User Workflows: ${userWorkflows.length}`);
        
        if (demoCount > 0 && isProduction) {
            console.warn(`   ⚠️  WARNING: Demo workflows found in production!`);
        }
        
        // 5. Recommendations
        console.log('\n5. RECOMMENDATIONS');
        console.log('=' .repeat(50));
        
        if (evictedKeys > 0) {
            console.log('\n   ❌ CRITICAL ISSUE: Data Eviction Detected');
            console.log('   Actions to take:');
            console.log('   1. Increase Redis memory limit');
            console.log('   2. Clean up unnecessary data');
            console.log('   3. Set eviction policy to "noeviction" for production');
            console.log('   4. Consider using Redis persistence (RDB/AOF)');
        }
        
        if (evictionPolicy && evictionPolicy !== 'noeviction' && isProduction) {
            console.log('\n   ⚠️  Eviction Policy Issue');
            console.log(`   Current policy: ${evictionPolicy}`);
            console.log('   Recommended: Set to "noeviction" in production');
        }
        
        if (demoCount > 0 && isProduction) {
            console.log('\n   ⚠️  Demo Data in Production');
            console.log('   Run cleanup to remove demo workflows');
            console.log('   Set ENABLE_DEMO_DATA=false in environment');
        }
        
        if (maxMemory === 0) {
            console.log('\n   ℹ️  No Memory Limit Set');
            console.log('   Consider setting maxmemory to prevent unbounded growth');
        }
        
        console.log('\n✅ Health check completed!\n');
        
        return {
            healthy: evictedKeys === 0,
            evictedKeys,
            memoryUsage: maxMemory > 0 ? (usedMemory / maxMemory) * 100 : 0,
            workflowCount: actualWorkflows.length,
            demoWorkflows: demoCount
        };
        
    } catch (error) {
        console.error('❌ Error during health check:', error);
        return {
            healthy: false,
            error: error.message
        };
    }
}

async function cleanupDemoWorkflows() {
    if (!isProduction) {
        console.log('⚠️  This command should only be run in production');
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        const answer = await new Promise(resolve => {
            readline.question('Continue anyway? (yes/no): ', resolve);
        });
        readline.close();
        
        if (answer.toLowerCase() !== 'yes') {
            console.log('Cleanup cancelled');
            return;
        }
    }
    
    console.log('\n🧹 Cleaning up demo workflows...\n');
    
    try {
        const workflowKeys = await ioredisClient.keys('workflow:*');
        const actualWorkflows = workflowKeys.filter(key => key.match(/^workflow:[a-f0-9-]+$/));
        
        let deletedCount = 0;
        
        for (const key of actualWorkflows) {
            const workflow = await ioredisClient.get(key);
            if (workflow) {
                const parsed = JSON.parse(workflow);
                if (parsed.userId === 'demo') {
                    await ioredisClient.del(key);
                    console.log(`   Deleted: ${parsed.name} (${parsed.id})`);
                    deletedCount++;
                }
            }
        }
        
        // Clean up related demo data
        await ioredisClient.del('user:demo:workflows');
        
        console.log(`\n✅ Cleaned up ${deletedCount} demo workflows\n`);
        
    } catch (error) {
        console.error('❌ Error during cleanup:', error);
    }
}

async function analyzeMemoryUsage() {
    console.log('\n📊 Detailed Memory Analysis\n');
    console.log('=' .repeat(50));
    
    try {
        // Get all keys and analyze their memory usage
        const keys = await ioredisClient.keys('*');
        const keysBySize = [];
        
        console.log(`\nAnalyzing ${keys.length} keys...\n`);
        
        for (const key of keys) {
            try {
                const memUsage = await ioredisClient.memory('USAGE', key);
                keysBySize.push({ key, size: memUsage });
            } catch (err) {
                // Memory USAGE command might not be available in all Redis versions
                console.warn(`Could not get memory usage for key: ${key}`);
            }
        }
        
        // Sort by size
        keysBySize.sort((a, b) => b.size - a.size);
        
        // Show top 20 largest keys
        console.log('Top 20 Largest Keys:');
        console.log('-'.repeat(50));
        
        for (let i = 0; i < Math.min(20, keysBySize.length); i++) {
            const { key, size } = keysBySize[i];
            const sizeKB = (size / 1024).toFixed(2);
            console.log(`${i + 1}. ${key}: ${sizeKB} KB`);
        }
        
        // Calculate total and average
        const totalSize = keysBySize.reduce((sum, item) => sum + item.size, 0);
        const avgSize = totalSize / keysBySize.length;
        
        console.log('\nSummary:');
        console.log(`Total Memory Used: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`Average Key Size: ${(avgSize / 1024).toFixed(2)} KB`);
        
    } catch (error) {
        console.error('❌ Error during memory analysis:', error);
        console.log('Note: Memory analysis requires Redis 4.0+ with MEMORY command support');
    }
}

// Export functions
module.exports = {
    checkRedisHealth,
    cleanupDemoWorkflows,
    analyzeMemoryUsage
};

// CLI interface
if (require.main === module) {
    const command = process.argv[2];
    
    switch (command) {
        case 'check':
            checkRedisHealth()
                .then(() => process.exit(0))
                .catch(err => {
                    console.error(err);
                    process.exit(1);
                });
            break;
            
        case 'cleanup':
            cleanupDemoWorkflows()
                .then(() => process.exit(0))
                .catch(err => {
                    console.error(err);
                    process.exit(1);
                });
            break;
            
        case 'analyze':
            analyzeMemoryUsage()
                .then(() => process.exit(0))
                .catch(err => {
                    console.error(err);
                    process.exit(1);
                });
            break;
            
        default:
            console.log('Redis Health Check Utility');
            console.log('Usage: node redisHealthCheck.js [command]');
            console.log('\nCommands:');
            console.log('  check    - Run health check');
            console.log('  cleanup  - Remove demo workflows');
            console.log('  analyze  - Analyze memory usage');
            process.exit(0);
    }
}
