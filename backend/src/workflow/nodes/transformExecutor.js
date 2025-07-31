const vm = require('vm');

async function execute(nodeConfig, inputs, context) {
    const { code, timeout = 5000 } = nodeConfig;
    
    try {
        // Log execution start
        await context.log('info', 'Executing transform node');
        
        // Create a sandboxed context for code execution
        const sandbox = {
            // Provide access to inputs
            inputs,
            input: inputs, // Alias for convenience
            
            // Provide common utilities
            console: {
                log: (msg) => context.log('info', `[Transform] ${msg}`),
                error: (msg) => context.log('error', `[Transform] ${msg}`),
                warn: (msg) => context.log('warn', `[Transform] ${msg}`)
            },
            
            // Math and Date are safe to expose
            Math,
            Date,
            
            // JSON utilities
            JSON,
            
            // Array methods
            Array,
            
            // Object methods
            Object,
            
            // String methods
            String,
            
            // Number methods
            Number,
            
            // Helper functions
            helpers: {
                // Extract nested values safely
                get: (obj, path, defaultValue = null) => {
                    const keys = path.split('.');
                    let result = obj;
                    for (const key of keys) {
                        if (result && typeof result === 'object' && key in result) {
                            result = result[key];
                        } else {
                            return defaultValue;
                        }
                    }
                    return result;
                },
                
                // Set nested values
                set: (obj, path, value) => {
                    const keys = path.split('.');
                    const lastKey = keys.pop();
                    let current = obj;
                    
                    for (const key of keys) {
                        if (!(key in current) || typeof current[key] !== 'object') {
                            current[key] = {};
                        }
                        current = current[key];
                    }
                    
                    current[lastKey] = value;
                    return obj;
                },
                
                // Format date
                formatDate: (date, format = 'ISO') => {
                    const d = new Date(date);
                    if (format === 'ISO') return d.toISOString();
                    if (format === 'locale') return d.toLocaleString();
                    if (format === 'date') return d.toLocaleDateString();
                    if (format === 'time') return d.toLocaleTimeString();
                    return d.toString();
                }
            }
        };
        
        // Create the script
        const script = new vm.Script(`
            (function() {
                ${code}
            })()
        `);
        
        // Run the script in the sandbox with timeout
        const result = await script.runInNewContext(sandbox, {
            timeout,
            displayErrors: true
        });
        
        // Log success
        await context.log('info', 'Transform executed successfully');
        
        // Return the result
        return result !== undefined ? result : inputs;
        
    } catch (error) {
        // Log error
        await context.log('error', `Transform execution failed: ${error.message}`);
        
        // Return error information
        return {
            error: true,
            message: 'Transform execution failed',
            details: error.message,
            code: code,
            inputs: inputs
        };
    }
}

module.exports = { execute };
