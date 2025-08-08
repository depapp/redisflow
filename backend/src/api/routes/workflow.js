const express = require('express');
const router = express.Router();
const { ioredisClient, redisClient } = require('../../config/redis');
const { v4: uuidv4 } = require('uuid');
const { createWorkflowLimiter, validateWorkflowCreation } = require('../../middleware/security');

// Get all workflows
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 20, search = '' } = req.query;
        const offset = (page - 1) * limit;
        
        // Get all workflow keys
        const keys = await ioredisClient.keys('workflow:*');
        
        // Filter out non-workflow keys (like workflow:executions)
        const workflowKeys = keys.filter(key => key.match(/^workflow:[a-f0-9-]+$/));
        
        // Get workflows
        const workflows = await Promise.all(
            workflowKeys.map(async (key) => {
                const workflow = await ioredisClient.get(key);
                return JSON.parse(workflow);
            })
        );
        
        // Filter by search term
        const filtered = workflows.filter(w => 
            !search || 
            w.name.toLowerCase().includes(search.toLowerCase()) ||
            w.description?.toLowerCase().includes(search.toLowerCase())
        );
        
        // Sort by updated date
        filtered.sort((a, b) => new Date(b.updated) - new Date(a.updated));
        
        // Paginate
        const paginated = filtered.slice(offset, offset + parseInt(limit));
        
        // Get activity metrics for each workflow
        const withMetrics = await Promise.all(
            paginated.map(async (workflow) => {
                const [executions, activeUsers] = await Promise.all([
                    ioredisClient.get(`metrics:workflow:${workflow.id}:executions`),
                    ioredisClient.scard(`presence:${workflow.id}`)
                ]);
                
                return {
                    ...workflow,
                    metrics: {
                        executions: parseInt(executions) || 0,
                        activeUsers
                    }
                };
            })
        );
        
        res.json({
            workflows: withMetrics,
            total: filtered.length,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error('Error fetching workflows:', error);
        res.status(500).json({ error: 'Failed to fetch workflows' });
    }
});

// Get single workflow
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const workflow = await ioredisClient.get(`workflow:${id}`);
        
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }
        
        const parsed = JSON.parse(workflow);
        
        // Get additional metrics
        const [executions, activeUsers, lastExecution] = await Promise.all([
            ioredisClient.get(`metrics:workflow:${id}:executions`),
            ioredisClient.scard(`presence:${id}`),
            ioredisClient.xrevrange(`executions:${id}`, '+', '-', 'COUNT', 1)
        ]);
        
        res.json({
            ...parsed,
            metrics: {
                executions: parseInt(executions) || 0,
                activeUsers,
                lastExecution: lastExecution[0] ? lastExecution[0][1] : null
            }
        });
    } catch (error) {
        console.error('Error fetching workflow:', error);
        res.status(500).json({ error: 'Failed to fetch workflow' });
    }
});

// Create new workflow (with rate limiting and validation)
router.post('/', createWorkflowLimiter, validateWorkflowCreation, async (req, res) => {
    try {
        const { name, description, nodes = [], connections = [] } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Workflow name is required' });
        }
        
        const workflow = {
            id: uuidv4(),
            name,
            description: description || '',
            nodes,
            connections,
            settings: {
                gridSize: 20,
                snapToGrid: true,
                theme: 'light'
            },
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            version: 1
        };
        
        // Store workflow in Redis
        await ioredisClient.set(
            `workflow:${workflow.id}`,
            JSON.stringify(workflow)
        );
        
        // Initialize metrics
        await ioredisClient.set(`metrics:workflow:${workflow.id}:executions`, 0);
        
        // Add to sorted set for efficient sorting
        await ioredisClient.zadd(
            'workflows:by_date',
            Date.now(),
            workflow.id
        );
        
        // Log creation event
        await ioredisClient.xadd(
            'workflow:events',
            '*',
            'type', 'created',
            'workflowId', workflow.id,
            'userId', req.headers['x-user-id'] || 'anonymous',
            'timestamp', Date.now()
        );
        
        res.status(201).json(workflow);
    } catch (error) {
        console.error('Error creating workflow:', error);
        res.status(500).json({ error: 'Failed to create workflow' });
    }
});

// Update workflow
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        // Get existing workflow
        const existing = await ioredisClient.get(`workflow:${id}`);
        if (!existing) {
            return res.status(404).json({ error: 'Workflow not found' });
        }
        
        const workflow = JSON.parse(existing);
        
        // Update workflow
        const updated = {
            ...workflow,
            ...updates,
            id: workflow.id, // Prevent ID change
            created: workflow.created, // Preserve creation date
            updated: new Date().toISOString(),
            version: workflow.version + 1
        };
        
        // Store updated workflow
        await ioredisClient.set(
            `workflow:${id}`,
            JSON.stringify(updated)
        );
        
        // Update sorted set
        await ioredisClient.zadd(
            'workflows:by_date',
            Date.now(),
            id
        );
        
        // Log update event
        await ioredisClient.xadd(
            'workflow:events',
            '*',
            'type', 'updated',
            'workflowId', id,
            'userId', req.headers['x-user-id'] || 'anonymous',
            'changes', JSON.stringify(Object.keys(updates)),
            'timestamp', Date.now()
        );
        
        res.json(updated);
    } catch (error) {
        console.error('Error updating workflow:', error);
        res.status(500).json({ error: 'Failed to update workflow' });
    }
});

// Delete workflow
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Check if workflow exists
        const exists = await ioredisClient.exists(`workflow:${id}`);
        if (!exists) {
            return res.status(404).json({ error: 'Workflow not found' });
        }
        
        // Delete workflow and related data
        const multi = ioredisClient.multi();
        multi.del(`workflow:${id}`);
        multi.del(`metrics:workflow:${id}:executions`);
        multi.del(`history:${id}`);
        multi.zrem('workflows:by_date', id);
        
        await multi.exec();
        
        // Log deletion event
        await ioredisClient.xadd(
            'workflow:events',
            '*',
            'type', 'deleted',
            'workflowId', id,
            'userId', req.headers['x-user-id'] || 'anonymous',
            'timestamp', Date.now()
        );
        
        res.json({ message: 'Workflow deleted successfully' });
    } catch (error) {
        console.error('Error deleting workflow:', error);
        res.status(500).json({ error: 'Failed to delete workflow' });
    }
});

// Clone workflow
router.post('/:id/clone', async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        
        // Get original workflow
        const original = await ioredisClient.get(`workflow:${id}`);
        if (!original) {
            return res.status(404).json({ error: 'Workflow not found' });
        }
        
        const workflow = JSON.parse(original);
        
        // Create clone
        const clone = {
            ...workflow,
            id: uuidv4(),
            name: name || `${workflow.name} (Copy)`,
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            version: 1
        };
        
        // Store clone
        await ioredisClient.set(
            `workflow:${clone.id}`,
            JSON.stringify(clone)
        );
        
        // Initialize metrics for clone
        await ioredisClient.set(`metrics:workflow:${clone.id}:executions`, 0);
        
        // Add to sorted set
        await ioredisClient.zadd(
            'workflows:by_date',
            Date.now(),
            clone.id
        );
        
        res.status(201).json(clone);
    } catch (error) {
        console.error('Error cloning workflow:', error);
        res.status(500).json({ error: 'Failed to clone workflow' });
    }
});

// Get workflow history
router.get('/:id/history', async (req, res) => {
    try {
        const { id } = req.params;
        const { limit = 50 } = req.query;
        
        // Get history from Redis stream
        const history = await ioredisClient.xrevrange(
            `history:${id}`,
            '+',
            '-',
            'COUNT',
            limit
        );
        
        // Format history entries
        const formatted = history.map(([entryId, fields]) => {
            const entry = {};
            for (let i = 0; i < fields.length; i += 2) {
                entry[fields[i]] = fields[i + 1];
            }
            return {
                id: entryId,
                ...entry,
                change: JSON.parse(entry.change || '{}')
            };
        });
        
        res.json(formatted);
    } catch (error) {
        console.error('Error fetching workflow history:', error);
        res.status(500).json({ error: 'Failed to fetch workflow history' });
    }
});

module.exports = router;
