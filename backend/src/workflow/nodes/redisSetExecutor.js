const { ioredisClient } = require('../../config/redis');

async function execute(nodeConfig, inputs, context) {
    const { key, value, ttl, dataType = 'string' } = nodeConfig;
    
    try {
        // Process key with template variables
        const processedKey = replaceTemplateVariables(key, inputs, context);
        
        // Log execution start
        await context.log('info', `Setting Redis key: ${processedKey}`);
        
        // Determine what value to store
        let valueToStore;
        if (value !== undefined && value !== null && value !== '') {
            // Check if the value looks like a failed template attempt
            if (value === '${JSON.stringify(data)}' || value === '[object Object]') {
                // Use input from previous node instead
                valueToStore = inputs;
            } else {
                // Use configured value
                valueToStore = value;
            }
        } else {
            // Use input from previous node
            valueToStore = inputs;
        }
        
        // Process value with template variables if it's a string
        if (typeof valueToStore === 'string') {
            valueToStore = replaceTemplateVariables(valueToStore, inputs, context);
        }
        
        let result;
        let actualStoredValue = valueToStore; // Track what we actually store
        
        // Store based on data type
        switch (dataType) {
            case 'string':
                // Convert objects to JSON string
                console.log('valueToStore type:', typeof valueToStore);
                console.log('valueToStore:', valueToStore);
                
                const stringValue = typeof valueToStore === 'object' 
                    ? JSON.stringify(valueToStore) 
                    : String(valueToStore);
                
                console.log('stringValue:', stringValue);
                actualStoredValue = stringValue;
                
                if (ttl && ttl > 0) {
                    result = await ioredisClient.setex(processedKey, ttl, stringValue);
                } else {
                    result = await ioredisClient.set(processedKey, stringValue);
                }
                break;
                
            case 'hash':
                // Store as hash (object)
                if (typeof valueToStore === 'object' && !Array.isArray(valueToStore)) {
                    // Flatten object for hash storage
                    const hashData = {};
                    for (const [k, v] of Object.entries(valueToStore)) {
                        hashData[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
                    }
                    result = await ioredisClient.hset(processedKey, hashData);
                    
                    if (ttl && ttl > 0) {
                        await ioredisClient.expire(processedKey, ttl);
                    }
                } else {
                    throw new Error('Hash data type requires an object value');
                }
                break;
                
            case 'list':
                // Store as list (push to right)
                const listValues = Array.isArray(valueToStore) ? valueToStore : [valueToStore];
                const processedListValues = listValues.map(v => 
                    typeof v === 'object' ? JSON.stringify(v) : String(v)
                );
                result = await ioredisClient.rpush(processedKey, ...processedListValues);
                
                if (ttl && ttl > 0) {
                    await ioredisClient.expire(processedKey, ttl);
                }
                break;
                
            case 'set':
                // Store as set
                const setValues = Array.isArray(valueToStore) ? valueToStore : [valueToStore];
                const processedSetValues = setValues.map(v => 
                    typeof v === 'object' ? JSON.stringify(v) : String(v)
                );
                result = await ioredisClient.sadd(processedKey, ...processedSetValues);
                
                if (ttl && ttl > 0) {
                    await ioredisClient.expire(processedKey, ttl);
                }
                break;
                
            case 'json':
                // Store as JSON (using RedisJSON if available, otherwise as string)
                const jsonString = JSON.stringify(valueToStore);
                if (ttl && ttl > 0) {
                    result = await ioredisClient.setex(processedKey, ttl, jsonString);
                } else {
                    result = await ioredisClient.set(processedKey, jsonString);
                }
                break;
                
            default:
                throw new Error(`Unsupported data type: ${dataType}`);
        }
        
        // Log success
        await context.log('info', `Successfully set Redis key: ${processedKey}`);
        
        // Return success response
        return {
            success: true,
            key: processedKey,
            value: actualStoredValue, // Return the actual stored value
            dataType,
            ttl: ttl || null,
            result,
            timestamp: new Date().toISOString(),
            // Pass through the original input data for downstream nodes
            ...inputs
        };
        
    } catch (error) {
        // Log error
        await context.log('error', `Redis SET failed: ${error.message}`);
        
        // Return error information
        return {
            error: true,
            message: 'Redis SET operation failed',
            details: error.message,
            key: key,
            value: value
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
