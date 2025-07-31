const express = require('express');
const router = express.Router();
const { ioredisClient } = require('../../config/redis');
const { v4: uuidv4 } = require('uuid');
const { Queue, Worker } = require('bullmq');

// Create execution queue
const executionQueue = new Queue('workflow-executions', {
    connection: {
        host: ioredisClient.options.host,
        port: ioredisClient.options.port,
        username: ioredisClient.options.username,
        password: ioredisClient.options.password,
        maxRetriesPerRequest: null
    }
});

// Execute workflow
router.post('/', async (req, res) => {
    try {
        const { workflowId, inputs = {}, mode = 'async' } = req.body;
        
        if (!workflowId) {
            return res.status(400).json({ error: 'Workflow ID is required' });
        }
        
        // Check if workflow exists
        const workflow = await ioredisClient.get(`workflow:${workflowId}`);
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }
        
        const executionId = uuidv4();
        const execution = {
            id: executionId,
            workflowId,
            status: 'pending',
            inputs,
            startedAt: new Date().toISOString(),
            userId: req.headers['x-user-id'] || 'anonymous'
        };
        
        // Store execution record
        await ioredisClient.hset(`execution:${executionId}`, execution);
        
        // Add to workflow's execution stream
        await ioredisClient.xadd(
            `executions:${workflowId}`,
            '*',
            'executionId', executionId,
            'status', 'started',
            'timestamp', Date.now()
        );
        
        // Increment execution counter
        await ioredisClient.incr(`metrics:workflow:${workflowId}:executions`);
        
        // Track daily executions
        const today = new Date().toISOString().split('T')[0];
        await ioredisClient.incr(`metrics:executions:daily:${today}`);
        await ioredisClient.expire(`metrics:executions:daily:${today}`, 86400 * 7); // Keep for 7 days
        
        if (mode === 'async') {
            // Add to execution queue for background processing
            await executionQueue.add('execute', {
                executionId,
                workflowId,
                workflow: JSON.parse(workflow),
                inputs
            }, {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 2000
                }
            });
            
            res.json({
                executionId,
                status: 'queued',
                message: 'Workflow execution queued'
            });
        } else {
            // Execute synchronously (for demo purposes)
            const result = await executeWorkflowSync(
                executionId,
                JSON.parse(workflow),
                inputs
            );
            
            res.json({
                executionId,
                status: 'completed',
                result
            });
        }
    } catch (error) {
        console.error('Error executing workflow:', error);
        res.status(500).json({ error: 'Failed to execute workflow' });
    }
});

// Get execution status
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const execution = await ioredisClient.hgetall(`execution:${id}`);
        
        if (!execution || !execution.id) {
            return res.status(404).json({ error: 'Execution not found' });
        }
        
        // Get execution logs
        const logs = await ioredisClient.xrange(
            `execution:${id}:logs`,
            '-',
            '+'
        );
        
        // Format logs
        const formattedLogs = logs.map(([entryId, fields]) => {
            const log = {};
            for (let i = 0; i < fields.length; i += 2) {
                log[fields[i]] = fields[i + 1];
            }
            return {
                id: entryId,
                ...log,
                timestamp: parseInt(log.timestamp)
            };
        });
        
        res.json({
            ...execution,
            logs: formattedLogs
        });
    } catch (error) {
        console.error('Error fetching execution:', error);
        res.status(500).json({ error: 'Failed to fetch execution' });
    }
});

// Get execution logs stream
router.get('/:id/logs', async (req, res) => {
    try {
        const { id } = req.params;
        const { since = '-' } = req.query;
        
        // Set up SSE
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        
        // Send existing logs
        const logs = await ioredisClient.xrange(
            `execution:${id}:logs`,
            since,
            '+'
        );
        
        logs.forEach(([entryId, fields]) => {
            const log = {};
            for (let i = 0; i < fields.length; i += 2) {
                log[fields[i]] = fields[i + 1];
            }
            res.write(`data: ${JSON.stringify({ id: entryId, ...log })}\n\n`);
        });
        
        // Subscribe to new logs
        const subscriber = ioredisClient.duplicate();
        await subscriber.subscribe(`execution:${id}:log`);
        
        subscriber.on('message', (channel, message) => {
            res.write(`data: ${message}\n\n`);
        });
        
        // Clean up on disconnect
        req.on('close', () => {
            subscriber.unsubscribe();
            subscriber.quit();
        });
    } catch (error) {
        console.error('Error streaming logs:', error);
        res.status(500).json({ error: 'Failed to stream logs' });
    }
});

// Cancel execution
router.post('/:id/cancel', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Update execution status
        await ioredisClient.hset(`execution:${id}`, {
            status: 'cancelled',
            cancelledAt: new Date().toISOString()
        });
        
        // Log cancellation
        await ioredisClient.xadd(
            `execution:${id}:logs`,
            '*',
            'type', 'system',
            'message', 'Execution cancelled by user',
            'timestamp', Date.now()
        );
        
        res.json({ message: 'Execution cancelled' });
    } catch (error) {
        console.error('Error cancelling execution:', error);
        res.status(500).json({ error: 'Failed to cancel execution' });
    }
});

// Get workflow executions
router.get('/workflow/:workflowId', async (req, res) => {
    try {
        const { workflowId } = req.params;
        const { limit = 20 } = req.query;
        
        // Get executions from stream
        const executions = await ioredisClient.xrevrange(
            `executions:${workflowId}`,
            '+',
            '-',
            'COUNT',
            limit
        );
        
        // Get full execution details
        const detailed = await Promise.all(
            executions.map(async ([streamId, fields]) => {
                const executionId = fields[fields.indexOf('executionId') + 1];
                const execution = await ioredisClient.hgetall(`execution:${executionId}`);
                return {
                    streamId,
                    ...execution
                };
            })
        );
        
        res.json(detailed);
    } catch (error) {
        console.error('Error fetching workflow executions:', error);
        res.status(500).json({ error: 'Failed to fetch workflow executions' });
    }
});

// Import the workflow engine components
const { nodeExecutors, logExecution } = require('../../workflow/engine');

// Synchronous workflow execution using the real engine
async function executeWorkflowSync(executionId, workflow, inputs) {
    try {
        // Update status
        await ioredisClient.hset(`execution:${executionId}`, {
            status: 'running',
            startedAt: new Date().toISOString()
        });
        
        // Create execution context
        const context = {
            inputs,
            outputs: {},
            variables: {},
            executionId,
            workflowId: workflow.id
        };
        
        // Build execution order based on connections
        const nodeMap = new Map(workflow.nodes.map(n => [n.id, n]));
        const executionOrder = buildExecutionOrder(workflow.nodes, workflow.connections || []);
        
        // Execute nodes in order
        for (const nodeId of executionOrder) {
            const node = nodeMap.get(nodeId);
            if (!node) continue;
            
            // Get inputs from previous nodes
            const previousNodes = (workflow.connections || [])
                .filter(c => c.target === node.id)
                .map(c => c.source);
            
            // Combine outputs from all previous nodes
            let nodeInputs = {};
            if (previousNodes.length > 0) {
                // If single previous node, use its output directly
                if (previousNodes.length === 1) {
                    nodeInputs = context.outputs[previousNodes[0]] || {};
                } else {
                    // Multiple inputs, combine them
                    for (const prevNodeId of previousNodes) {
                        const prevOutput = context.outputs[prevNodeId];
                        if (prevOutput) {
                            nodeInputs[prevNodeId] = prevOutput;
                        }
                    }
                }
            } else {
                // No previous nodes, use workflow inputs
                nodeInputs = context.inputs;
            }
            
            // Create node execution context
            const nodeContext = {
                executionId,
                workflowId: workflow.id,
                nodeId: node.id,
                nodeName: node.name || node.type,
                nodeType: node.type,
                variables: context.variables,
                log: async (level, message, data = {}) => {
                    await logExecution(executionId, {
                        type: 'node_log',
                        nodeId: node.id,
                        nodeName: node.name || node.type,
                        level,
                        message,
                        ...data
                    });
                }
            };
            
            try {
                // Log node start
                await logExecution(executionId, {
                    type: 'node_start',
                    nodeId: node.id,
                    nodeName: node.name || node.type,
                    message: `Starting node: ${node.name || node.type}`
                });
                
                // Get node executor
                const executor = nodeExecutors[node.type];
                if (!executor) {
                    throw new Error(`No executor found for node type: ${node.type}`);
                }
                
                // Execute node with its configuration and inputs
                const result = await executor.execute(
                    node.config || {}, 
                    nodeInputs, 
                    nodeContext
                );
                
                // Store output
                context.outputs[node.id] = result;
                
                // Log node completion
                await logExecution(executionId, {
                    type: 'node_complete',
                    nodeId: node.id,
                    nodeName: node.name || node.type,
                    message: `Completed node: ${node.name || node.type}`,
                    result: JSON.stringify(result)
                });
                
            } catch (nodeError) {
                // Log node error
                await logExecution(executionId, {
                    type: 'node_error',
                    nodeId: node.id,
                    nodeName: node.name || node.type,
                    message: `Error in node: ${nodeError.message}`,
                    error: nodeError.stack
                });
                
                // Continue or fail based on node settings
                if (node.continueOnError) {
                    context.outputs[node.id] = { error: nodeError.message };
                } else {
                    throw nodeError;
                }
            }
        }
        
        // Update final status
        await ioredisClient.hset(`execution:${executionId}`, {
            status: 'completed',
            completedAt: new Date().toISOString(),
            outputs: JSON.stringify(context.outputs)
        });
        
        // Log completion
        await logExecution(executionId, {
            type: 'execution_complete',
            message: 'Workflow execution completed successfully',
            outputs: JSON.stringify(context.outputs)
        });
        
        return context.outputs;
        
    } catch (error) {
        // Update error status
        await ioredisClient.hset(`execution:${executionId}`, {
            status: 'failed',
            error: error.message,
            failedAt: new Date().toISOString()
        });
        
        // Log failure
        await logExecution(executionId, {
            type: 'execution_failed',
            message: `Workflow execution failed: ${error.message}`,
            error: error.stack
        });
        
        throw error;
    }
}

// Helper function to build execution order from connections
function buildExecutionOrder(nodes, connections) {
    const order = [];
    const visited = new Set();
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    
    // Find nodes with no incoming connections (start nodes)
    const startNodes = nodes.filter(node => 
        !connections.some(conn => conn.target === node.id)
    );
    
    // If no start nodes, use all nodes in order
    if (startNodes.length === 0) {
        return nodes.map(n => n.id);
    }
    
    // Depth-first traversal
    function visit(nodeId) {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);
        
        // Find all nodes this node connects to
        const nextNodes = connections
            .filter(conn => conn.source === nodeId)
            .map(conn => conn.target);
        
        // Visit them first (post-order)
        order.push(nodeId);
        nextNodes.forEach(visit);
    }
    
    // Start from all start nodes
    startNodes.forEach(node => visit(node.id));
    
    // Add any unvisited nodes
    nodes.forEach(node => {
        if (!visited.has(node.id)) {
            order.push(node.id);
        }
    });
    
    return order;
}

module.exports = router;
