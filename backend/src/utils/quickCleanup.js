const { ioredisClient } = require('../config/redis');

async function quickCleanup() {
    console.log('\n🚀 Quick Cleanup - Removing excessive workflows\n');
    console.log('=' .repeat(50));
    
    try {
        // Connect to Redis
        console.log('Connecting to Redis...');
        await ioredisClient.ping();
        console.log('✅ Connected to Redis\n');
        
        // Get all workflow keys
        console.log('Fetching workflow keys...');
        const workflowKeys = await ioredisClient.keys('workflow:*');
        const actualWorkflows = workflowKeys.filter(key => key.match(/^workflow:[a-f0-9-]+$/));
        
        console.log(`Found ${actualWorkflows.length} workflows\n`);
        
        if (actualWorkflows.length === 0) {
            console.log('No workflows to clean up.');
            return;
        }
        
        // Keep only the most recent 20 workflows
        const KEEP_COUNT = 20;
        console.log(`Keeping only the ${KEEP_COUNT} most recent workflows...\n`);
        
        // Get workflow data with creation dates
        const workflowsWithDates = [];
        let processed = 0;
        
        console.log('Processing workflows (this may take a moment)...');
        
        // Process in batches to avoid memory issues
        const BATCH_SIZE = 100;
        for (let i = 0; i < actualWorkflows.length; i += BATCH_SIZE) {
            const batch = actualWorkflows.slice(i, i + BATCH_SIZE);
            
            const batchPromises = batch.map(async (key) => {
                try {
                    const workflow = await ioredisClient.get(key);
                    if (workflow) {
                        const parsed = JSON.parse(workflow);
                        return {
                            key,
                            created: parsed.created || new Date().toISOString(),
                            name: parsed.name,
                            userId: parsed.userId
                        };
                    }
                } catch (err) {
                    console.warn(`Error processing ${key}:`, err.message);
                }
                return null;
            });
            
            const results = await Promise.all(batchPromises);
            workflowsWithDates.push(...results.filter(w => w !== null));
            
            processed += batch.length;
            if (processed % 500 === 0) {
                console.log(`  Processed ${processed}/${actualWorkflows.length} workflows...`);
            }
        }
        
        console.log(`\nProcessed all ${actualWorkflows.length} workflows`);
        
        // Sort by creation date (newest first)
        workflowsWithDates.sort((a, b) => new Date(b.created) - new Date(a.created));
        
        // Identify workflows to delete (keep only the most recent ones)
        const workflowsToKeep = workflowsWithDates.slice(0, KEEP_COUNT);
        const workflowsToDelete = workflowsWithDates.slice(KEEP_COUNT);
        
        console.log(`\nKeeping ${workflowsToKeep.length} workflows`);
        console.log(`Deleting ${workflowsToDelete.length} workflows\n`);
        
        if (workflowsToDelete.length === 0) {
            console.log('Nothing to delete.');
            return;
        }
        
        // Show what we're keeping
        console.log('Workflows being kept:');
        workflowsToKeep.forEach((w, i) => {
            console.log(`  ${i + 1}. ${w.name} (${w.userId}) - ${new Date(w.created).toLocaleDateString()}`);
        });
        
        console.log('\nDeleting old workflows...');
        
        // Delete in batches
        const DELETE_BATCH_SIZE = 100;
        let deleted = 0;
        
        for (let i = 0; i < workflowsToDelete.length; i += DELETE_BATCH_SIZE) {
            const batch = workflowsToDelete.slice(i, i + DELETE_BATCH_SIZE);
            const keysToDelete = batch.map(w => w.key);
            
            if (keysToDelete.length > 0) {
                await ioredisClient.del(...keysToDelete);
                deleted += keysToDelete.length;
                
                if (deleted % 500 === 0 || deleted === workflowsToDelete.length) {
                    console.log(`  Deleted ${deleted}/${workflowsToDelete.length} workflows...`);
                }
            }
        }
        
        // Clean up related data
        console.log('\nCleaning up related data...');
        
        // Clean up metrics for deleted workflows
        const metricsKeys = workflowsToDelete.map(w => `metrics:workflow:${w.key.split(':')[1]}:executions`);
        for (let i = 0; i < metricsKeys.length; i += DELETE_BATCH_SIZE) {
            const batch = metricsKeys.slice(i, i + DELETE_BATCH_SIZE);
            if (batch.length > 0) {
                await ioredisClient.del(...batch);
            }
        }
        
        // Clean up sorted sets
        const deletedIds = workflowsToDelete.map(w => w.key.split(':')[1]);
        for (const id of deletedIds) {
            await ioredisClient.zrem('workflows:by_date', id);
            await ioredisClient.zrem('workflows:all', id);
            await ioredisClient.zrem('workflows:popular', id);
        }
        
        console.log('\n✅ Cleanup completed!');
        console.log(`   - Kept ${workflowsToKeep.length} workflows`);
        console.log(`   - Deleted ${deleted} workflows`);
        
        // Final check
        const remainingKeys = await ioredisClient.keys('workflow:*');
        const remainingWorkflows = remainingKeys.filter(key => key.match(/^workflow:[a-f0-9-]+$/));
        console.log(`   - Total workflows now: ${remainingWorkflows.length}`);
        
    } catch (error) {
        console.error('❌ Error during cleanup:', error);
    } finally {
        await ioredisClient.quit();
        process.exit(0);
    }
}

// Run the cleanup
quickCleanup();
