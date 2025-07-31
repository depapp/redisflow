const { ioredisClient } = require('../../config/redis');

async function execute(nodeConfig, inputs, context) {
    const { key, dataType = 'string', parseJson = true } = nodeConfig;
    
    try {
        // Process key with template variables
        const processedKey = replaceTemplateVariables(key, inputs, context);
        
        // Log execution start
        await context.log('info', `Getting Redis key: ${processedKey}`);
        
        let result;
        let value;
        
        // Get based on data type
        switch (dataType) {
            case 'string':
                value = await ioredisClient.get(processedKey);
                
                // Try to parse JSON if enabled and value looks like JSON
                if (parseJson && value && (value.startsWith('{') || value.startsWith('['))) {
                    try {
                        value = JSON.parse(value);
                    } catch (e) {
                        // Keep as string if parsing fails
                    }
                }
                break;
                
            case 'hash':
                value = await ioredisClient.hgetall(processedKey);
                
                // Parse JSON values in hash if enabled
                if (parseJson && value) {
                    for (const [k, v] of Object.entries(value)) {
                        if (v && (v.startsWith('{') || v.startsWith('['))) {
                            try {
                                value[k] = JSON.parse(v);
                            } catch (e) {
                                // Keep as string if parsing fails
                            }
                        }
                    }
                }
                
                // Return null if hash doesn't exist (empty object)
                if (Object.keys(value).length === 0) {
                    value = null;
                }
                break;
                
            case 'list':
                // Get entire list
                value = await ioredisClient.lrange(processedKey, 0, -1);
                
                // Parse JSON values in list if enabled
                if (parseJson && value) {
                    value = value.map(v => {
                        if (v && (v.startsWith('{') || v.startsWith('['))) {
                            try {
                                return JSON.parse(v);
                            } catch (e) {
                                return v;
                            }
                        }
                        return v;
                    });
                }
                
                // Return null if list is empty
                if (value.length === 0) {
                    value = null;
                }
                break;
                
            case 'set':
                // Get all members of set
                value = await ioredisClient.smembers(processedKey);
                
                // Parse JSON values in set if enabled
                if (parseJson && value) {
                    value = value.map(v => {
                        if (v && (v.startsWith('{') || v.startsWith('['))) {
                            try {
                                return JSON.parse(v);
                            } catch (e) {
                                return v;
                            }
                        }
                        return v;
                    });
                }
                
                // Return null if set is empty
                if (value.length === 0) {
                    value = null;
                }
                break;
                
            case 'json':
                // Get as string and parse
                value = await ioredisClient.get(processedKey);
                if (value) {
                    try {
                        value = JSON.parse(value);
                    } catch (e) {
                        throw new Error(`Failed to parse JSON value: ${e.message}`);
                    }
                }
                break;
                
            default:
                throw new Error(`Unsupported data type: ${dataType}`);
        }
        
        // Check if key exists
        if (value === null || value === undefined) {
            await context.log('warn', `Redis key not found: ${processedKey}`);
            
            return {
                success: false,
                found: false,
                key: processedKey,
                value: null,
                message: 'Key not found'
            };
        }
        
        // Log success
        await context.log('info', `Successfully retrieved Redis key: ${processedKey}`);
        
        // Return the value
        return {
            success: true,
            found: true,
            key: processedKey,
            value: value,
            dataType,
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        // Log error
        await context.log('error', `Redis GET failed: ${error.message}`);
        
        // Return error information
        return {
            error: true,
            message: 'Redis GET operation failed',
            details: error.message,
            key: key
        };
    }
}

// Helper function to replace template variables
function replaceTemplateVariables(str, inputs, context) {
    if (!str || typeof str !== 'string') return str;
    
    return str.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
        try {
            const parts = path.trim().split('.');
            let value = { ...inputs, ...context.variables };
            
            for (const part of parts) {
                if (value && typeof value === 'object' && part in value) {
                    value = value[part];
                } else {
                    return match;
                }
            }
            
            return value;
        } catch (e) {
            return match;
        }
    });
}

module.exports = { execute };
