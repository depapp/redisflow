async function execute(nodeConfig, inputs, context) {
    const { 
        delay = 1000, 
        unit = 'milliseconds',
        message = 'Waiting...'
    } = nodeConfig;
    
    try {
        // Calculate delay in milliseconds
        let delayMs = parseInt(delay) || 1000;
        
        switch (unit) {
            case 'seconds':
                delayMs = delayMs * 1000;
                break;
            case 'minutes':
                delayMs = delayMs * 60 * 1000;
                break;
            case 'hours':
                delayMs = delayMs * 60 * 60 * 1000;
                break;
            case 'milliseconds':
            default:
                // Already in milliseconds
                break;
        }
        
        // Cap delay at 5 minutes for safety
        const maxDelay = 5 * 60 * 1000; // 5 minutes
        if (delayMs > maxDelay) {
            await context.log('warn', `Delay capped at 5 minutes (requested: ${delayMs}ms)`);
            delayMs = maxDelay;
        }
        
        // Log start of delay
        const delayMessage = replaceTemplateVariables(message, inputs, context);
        await context.log('info', `${delayMessage} (${delayMs}ms)`);
        
        // Store delay start time
        const startTime = Date.now();
        
        // Perform the delay
        await new Promise(resolve => setTimeout(resolve, delayMs));
        
        // Calculate actual delay
        const actualDelay = Date.now() - startTime;
        
        // Log completion
        await context.log('info', `Delay completed after ${actualDelay}ms`);
        
        // Return delay information along with inputs
        return {
            ...inputs, // Pass through inputs
            delay: {
                requested: delayMs,
                actual: actualDelay,
                unit: unit,
                startTime: new Date(startTime).toISOString(),
                endTime: new Date().toISOString(),
                message: delayMessage
            }
        };
        
    } catch (error) {
        // Log error
        await context.log('error', `Delay execution failed: ${error.message}`);
        
        // Return error information
        return {
            error: true,
            message: 'Delay execution failed',
            details: error.message,
            inputs
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
