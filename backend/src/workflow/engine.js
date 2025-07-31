const { ioredisClient } = require('../config/redis');
const { Worker } = require('bullmq');
const path = require('path');
const fs = require('fs');

// Load node executors dynamically
const nodeExecutors = {};
const nodeTypesDir = path.join(__dirname, 'nodes');

// Map node types to executor file names
const nodeTypeMapping = {
    'httpRequest': 'httpRequestExecutor',
    'transform': 'transformExecutor',
    'redisGet': 'redisGetExecutor',
    'redisSet': 'redisSetExecutor',
    'condition': 'conditionExecutor',
    'delay': 'delayExecutor',
    'logger': 'loggerExecutor'
};

// Load executors
for (const [nodeType, executorName] of Object.entries(nodeTypeMapping)) {
    try {
        const executorPath = path.join(nodeTypesDir, `${executorName}.js`);
        if (fs.existsSync(executorPath)) {
            nodeExecutors[nodeType] = require(executorPath);
            console.log(`Loaded executor for ${nodeType}`);
        } else {
            console.warn(`Executor file not found for ${nodeType}: ${executorPath}`);
        }
    } catch (error) {
        console.error(`Failed to load executor for ${nodeType}:`, error.message);
    }
}

// Fallback for missing executors
const fallbackExecutor = {
    execute: async (nodeConfig, inputs, context) => {
        console.warn(`No executor found for node type: ${context.nodeType}`);
        return {
            warning: 'No executor implemented',
            nodeType: context.nodeType,
            inputs: inputs
        };
    }
};

// Create workflow execution worker
const executionWorker = new Worker('workflow-executions', async (job) => {
    const { executionId, workflowId, workflow, inputs } = job.data;
    
    try {
        console.log(`Starting execution ${executionId} for workflow ${workflowId}`);
        
        // Update execution status
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
            workflowId
        };
        
        // Build execution order based on connections
        const nodeMap = new Map(workflow.nodes.map(n => [n.id, n]));
        const executionOrder = buildExecutionOrder(workflow.nodes, workflow.connections);
        
        console.log('Execution order:', executionOrder);
        console.log('Node types:', executionOrder.map(id => ({id, type: nodeMap.get(id)?.type})));
        
        // Execute nodes in order
        for (const nodeId of executionOrder) {
            const node = nodeMap.get(nodeId);
            if (!node) continue;
            
            // Skip if this node was already marked as skipped
            if (context.outputs[nodeId]?.skipped) {
                await logExecution(executionId, {
                    type: 'node_skipped',
                    nodeId: node.id,
                    nodeName: node.name || node.type,
                    message: `Skipping node: ${node.name || node.type} - ${context.outputs[nodeId].reason}`
                });
                continue;
            }
            
            // Get inputs from previous nodes
            const previousNodes = workflow.connections
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
            
            // Check if any upstream condition node has failed
            let shouldSkip = false;
            for (const prevNodeId of previousNodes) {
                const prevOutput = context.outputs[prevNodeId];
                const prevNode = nodeMap.get(prevNodeId);
                console.log(`Checking previous node ${prevNodeId}:`, {
                    success: prevOutput?.success,
                    passed: prevOutput?.passed,
                    type: prevNode?.type,
                    isCondition: prevNode?.type === 'condition'
                });
                
                // Check if this is a condition node that failed
                if (prevNode?.type === 'condition' && prevOutput && prevOutput.success === false && prevOutput.passed === false) {
                    // This is a failed condition node, skip current node
                    console.log(`Skipping ${node.id} because upstream condition ${prevNodeId} failed`);
                    shouldSkip = true;
                    context.outputs[node.id] = {
                        skipped: true,
                        reason: 'Upstream condition evaluated to false',
                        skippedBy: prevNodeId
                    };
                    await logExecution(executionId, {
                        type: 'node_skipped',
                        nodeId: node.id,
                        nodeName: node.name || node.type,
                        message: `Skipping node: ${node.name || node.type} - Upstream condition failed`
                    });
                    break;
                }
            }
            
            if (shouldSkip) {
                continue;
            }
            
            // Create node execution context
            const nodeContext = {
                executionId,
                workflowId,
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
                const executor = nodeExecutors[node.type] || fallbackExecutor;
                
                // Execute node with its configuration and inputs
                const result = await executor.execute(
                    node.config || {}, 
                    nodeInputs, 
                    nodeContext
                );
                
                // Store output
                context.outputs[node.id] = result;
                
                // Check if this is a condition node that evaluated to false
                if (node.type === 'condition' && result.success === false && result.passed === false) {
                    // Log that condition failed
                    await logExecution(executionId, {
                        type: 'node_complete',
                        nodeId: node.id,
                        nodeName: node.name || node.type,
                        message: `Condition node evaluated to false, stopping downstream execution`,
                        result: JSON.stringify(result)
                    });
                    
                    // Mark all downstream nodes as skipped
                    const downstreamNodes = findDownstreamNodes(node.id, workflow.connections, workflow.nodes);
                    for (const downstreamNodeId of downstreamNodes) {
                        context.outputs[downstreamNodeId] = {
                            skipped: true,
                            reason: 'Upstream condition evaluated to false',
                            skippedBy: node.id
                        };
                    }
                } else {
                    // Log normal node completion
                    await logExecution(executionId, {
                        type: 'node_complete',
                        nodeId: node.id,
                        nodeName: node.name || node.type,
                        message: `Completed node: ${node.name || node.type}`,
                        result: JSON.stringify(result)
                    });
                }
                
                // Update progress
                await job.updateProgress({
                    currentNode: node.id,
                    completedNodes: Object.keys(context.outputs).length,
                    totalNodes: workflow.nodes.length
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
        
        // Update execution as completed
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
        console.error(`Execution ${executionId} failed:`, error);
        
        // Update execution as failed
        await ioredisClient.hset(`execution:${executionId}`, {
            status: 'failed',
            failedAt: new Date().toISOString(),
            error: error.message
        });
        
        // Log failure
        await logExecution(executionId, {
            type: 'execution_failed',
            message: `Workflow execution failed: ${error.message}`,
            error: error.stack
        });
        
        throw error;
    }
}, {
    connection: {
        host: ioredisClient.options.host,
        port: ioredisClient.options.port,
        username: ioredisClient.options.username,
        password: ioredisClient.options.password,
        maxRetriesPerRequest: null
    },
    concurrency: 5
});

// Helper function to log execution events
async function logExecution(executionId, logData) {
    const logEntry = {
        ...logData,
        timestamp: Date.now()
    };
    
    // Add to execution log stream
    await ioredisClient.xadd(
        `execution:${executionId}:logs`,
        '*',
        ...Object.entries(logEntry).flat()
    );
    
    // Publish for real-time updates
    await ioredisClient.publish(
        `execution:${executionId}:log`,
        JSON.stringify(logEntry)
    );
}

// Start the worker
executionWorker.on('completed', (job, result) => {
    console.log(`Job ${job.id} completed successfully`);
});

executionWorker.on('failed', (job, err) => {
    console.error(`Job ${job.id} failed:`, err);
});

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

// Helper function to find all downstream nodes from a given node
function findDownstreamNodes(nodeId, connections, nodes) {
    const downstream = new Set();
    const toVisit = [nodeId];
    
    while (toVisit.length > 0) {
        const currentId = toVisit.pop();
        
        // Find all nodes that this node connects to
        const directDownstream = connections
            .filter(conn => conn.source === currentId)
            .map(conn => conn.target);
        
        for (const downstreamId of directDownstream) {
            if (!downstream.has(downstreamId)) {
                downstream.add(downstreamId);
                toVisit.push(downstreamId);
            }
        }
    }
    
    return Array.from(downstream);
}

module.exports = {
    executionWorker,
    nodeExecutors,
    logExecution
};
