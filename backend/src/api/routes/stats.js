const express = require('express');
const router = express.Router();
const { ioredisClient } = require('../../config/redis');

// Get dashboard statistics
router.get('/dashboard', async (req, res) => {
    try {
        // Get today's date
        const today = new Date().toISOString().split('T')[0];
        
        // Get executions today
        const executionsToday = await ioredisClient.get(`metrics:executions:daily:${today}`) || '0';
        
        // Get active users (from active workflow rooms)
        const activeUsers = new Set();
        
        // Scan for active workflow rooms
        const stream = ioredisClient.scanStream({
            match: 'workflow:*:users',
            count: 100
        });
        
        const userSets = [];
        stream.on('data', (keys) => {
            if (keys.length) {
                userSets.push(...keys);
            }
        });
        
        await new Promise((resolve) => {
            stream.on('end', resolve);
        });
        
        // Get all users from all workflow rooms
        for (const key of userSets) {
            const users = await ioredisClient.smembers(key);
            users.forEach(user => activeUsers.add(user));
        }
        
        // Get total workflows count
        const workflowKeys = await ioredisClient.keys('workflow:*');
        const workflowCount = workflowKeys.filter(key => !key.includes(':users') && !key.includes(':metrics')).length;
        
        // Get Redis features count (this is static for now)
        const redisFeatures = {
            count: 12,
            features: [
                'Primary Database (JSON storage)',
                'Pub/Sub (Real-time collaboration)',
                'Streams (Event sourcing)',
                'Sets (User presence)',
                'Sorted Sets (Workflow ranking)',
                'Lists (Execution queues)',
                'HyperLogLog (Unique visitors)',
                'Bitmaps (Feature flags)',
                'Geospatial (Location-based)',
                'Time Series (Metrics)',
                'Search (Full-text search)',
                'Graph (Workflow dependencies)'
            ]
        };
        
        res.json({
            workflowCount,
            activeUserCount: activeUsers.size,
            executionsToday: parseInt(executionsToday),
            redisFeatures
        });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
    }
});

// Get workflow-specific statistics
router.get('/workflow/:workflowId', async (req, res) => {
    try {
        const { workflowId } = req.params;
        
        // Get execution count
        const executionCount = await ioredisClient.get(`metrics:workflow:${workflowId}:executions`) || '0';
        
        // Get active users for this workflow
        const activeUsers = await ioredisClient.smembers(`workflow:${workflowId}:users`);
        
        // Get recent executions
        const recentExecutions = await ioredisClient.xrevrange(
            `executions:${workflowId}`,
            '+',
            '-',
            'COUNT',
            5
        );
        
        res.json({
            executionCount: parseInt(executionCount),
            activeUsers: activeUsers.length,
            recentExecutions: recentExecutions.length
        });
    } catch (error) {
        console.error('Error fetching workflow stats:', error);
        res.status(500).json({ error: 'Failed to fetch workflow statistics' });
    }
});

module.exports = router;
