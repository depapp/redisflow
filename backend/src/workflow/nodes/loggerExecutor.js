const { ioredisClient } = require('../../config/redis');

async function execute(nodeConfig, inputs, context) {
    const { 
        level = 'info', 
        message = '', 
        includeInputs = false, // Changed default to false for cleaner output
        includeTimestamp = true,
        includeNodeInfo = false // Changed default to false for cleaner output
    } = nodeConfig;
    
    try {
        // Build log entry
        const logEntry = {
            level,
            timestamp: new Date().toISOString(),
            executionId: context.executionId,
            nodeId: context.nodeId,
            nodeName: context.nodeName || 'Logger'
        };
        
        // Process message with template variables
        if (message) {
            // Debug: log the inputs structure
            console.log('Logger inputs:', JSON.stringify(inputs, null, 2));
            logEntry.message = replaceTemplateVariables(message, inputs, context);
        } else {
            logEntry.message = 'Workflow execution log';
        }
        
        // Include inputs if requested
        if (includeInputs) {
            logEntry.inputs = inputs;
        }
        
        // Include node info if requested
        if (includeNodeInfo) {
            logEntry.node = {
                id: context.nodeId,
                name: context.nodeName,
                type: 'logger'
            };
        }
        
        // Format log message for console
        const consoleMessage = formatLogMessage(logEntry);
        
        // Log to execution logs
        await context.log(level, consoleMessage, logEntry);
        
        // Also store in a dedicated log stream for this workflow
        if (context.workflowId) {
            await ioredisClient.xadd(
                `workflow:${context.workflowId}:logs`,
                '*',
                'level', level,
                'message', logEntry.message,
                'executionId', context.executionId,
                'nodeId', context.nodeId,
                'timestamp', Date.now(),
                'data', JSON.stringify(logEntry)
            );
        }
        
        // Return the log entry as output
        return {
            success: true,
            logged: true,
            entry: logEntry,
            message: logEntry.message,
            level: level,
            timestamp: logEntry.timestamp
        };
        
    } catch (error) {
        // Even if logging fails, try to log the error
        await context.log('error', `Logger node failed: ${error.message}`);
        
        // Return error information
        return {
            error: true,
            message: 'Logger execution failed',
            details: error.message,
            originalMessage: message
        };
    }
}

// Format log message for console output
function formatLogMessage(logEntry) {
    const parts = [];
    
    // Add timestamp if included
    if (logEntry.timestamp) {
        parts.push(`[${new Date(logEntry.timestamp).toLocaleTimeString()}]`);
    }
    
    // Add level
    parts.push(`[${logEntry.level.toUpperCase()}]`);
    
    // Add node info
    if (logEntry.nodeName) {
        parts.push(`[${logEntry.nodeName}]`);
    }
    
    // Add message
    parts.push(logEntry.message);
    
    // Add inputs summary if present
    if (logEntry.inputs) {
        const inputSummary = summarizeObject(logEntry.inputs);
        if (inputSummary) {
            parts.push(`| Data: ${inputSummary}`);
        }
    }
    
    return parts.join(' ');
}

// Summarize object for logging
function summarizeObject(obj, maxLength = 100) {
    if (obj === null || obj === undefined) {
        return String(obj);
    }
    
    if (typeof obj !== 'object') {
        return String(obj).substring(0, maxLength);
    }
    
    try {
        const json = JSON.stringify(obj);
        if (json.length <= maxLength) {
            return json;
        }
        
        // For long objects, show keys and truncate
        const keys = Object.keys(obj);
        if (keys.length > 0) {
            return `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', ...' : ''}} (${keys.length} keys)`;
        }
        
        return json.substring(0, maxLength - 3) + '...';
    } catch (e) {
        return '[Complex Object]';
    }
}

// Helper function to replace template variables
function replaceTemplateVariables(str, inputs, context) {
    if (!str || typeof str !== 'string') return str;
    
    // Support both ${} and {{}} syntax
    return str
        .replace(/\$\{([^}]+)\}/g, (match, path) => {
            return processTemplatePath(path, inputs, context) ?? match;
        })
        .replace(/\{\{([^}]+)\}\}/g, (match, path) => {
            return processTemplatePath(path, inputs, context) ?? match;
        });
}

// Process a template path
function processTemplatePath(path, inputs, context) {
    try {
        const parts = path.trim().split('.');
        
        // Debug log
        console.log('Processing template path:', path);
        console.log('Input keys:', Object.keys(inputs));
        
        // Create a comprehensive context with multiple access patterns
        const dataContext = {
            ...inputs,
            ...context.variables,
            data: inputs,
            // If inputs has a data property, make it directly accessible
            ...(inputs.data && typeof inputs.data === 'object' ? inputs.data : {}),
            // If inputs has a value property (from Redis Get), make it directly accessible
            ...(inputs.value && typeof inputs.value === 'object' ? inputs.value : {}),
            // Also handle nested inputs structure (from condition node)
            ...(inputs.inputs && inputs.inputs.data && typeof inputs.inputs.data === 'object' ? inputs.inputs.data : {})
        };
        
        // Start from the appropriate context
        let value = dataContext;
        
        for (const part of parts) {
            if (value && typeof value === 'object' && part in value) {
                value = value[part];
            } else {
                return undefined;
            }
        }
        
        // Convert objects to string for display
        if (typeof value === 'object') {
            return JSON.stringify(value);
        }
        
        return value;
    } catch (e) {
        console.error('Template processing error:', e);
        return undefined;
    }
}

module.exports = { execute };
