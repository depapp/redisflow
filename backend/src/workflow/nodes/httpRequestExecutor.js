const axios = require('axios');

async function execute(nodeConfig, inputs, context) {
    const { url, method = 'GET', headers = {}, body, timeout = 30000 } = nodeConfig;
    
    try {
        // Replace template variables in URL
        const processedUrl = replaceTemplateVariables(url, inputs, context);
        
        // Log execution start
        await context.log('info', `Making ${method} request to: ${processedUrl}`);
        
        // Prepare request config
        const requestConfig = {
            method,
            url: processedUrl,
            headers: {
                'Content-Type': 'application/json',
                ...headers
            },
            timeout
        };
        
        // Add body for POST/PUT/PATCH requests
        if (['POST', 'PUT', 'PATCH'].includes(method.toUpperCase()) && body) {
            requestConfig.data = typeof body === 'string' ? JSON.parse(body) : body;
        }
        
        // Make the HTTP request
        const response = await axios(requestConfig);
        
        // Log success
        await context.log('info', `HTTP request successful. Status: ${response.status}`);
        
        // Return the response data in a cleaner format
        // Only include essential fields to reduce verbosity
        return {
            status: response.status,
            statusText: response.statusText,
            data: response.data,
            success: response.status >= 200 && response.status < 300
        };
        
    } catch (error) {
        // Log error
        await context.log('error', `HTTP request failed: ${error.message}`);
        
        // Return error information
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            return {
                error: true,
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data,
                message: error.message
            };
        } else if (error.request) {
            // The request was made but no response was received
            return {
                error: true,
                message: 'No response received from server',
                details: error.message
            };
        } else {
            // Something happened in setting up the request
            return {
                error: true,
                message: 'Request setup failed',
                details: error.message
            };
        }
    }
}

// Helper function to replace template variables like {{previousNode.output}}
function replaceTemplateVariables(str, inputs, context) {
    if (!str || typeof str !== 'string') return str;
    
    return str.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
        try {
            // Split the path and navigate through the object
            const parts = path.trim().split('.');
            let value = { ...inputs, ...context.variables };
            
            for (const part of parts) {
                if (value && typeof value === 'object' && part in value) {
                    value = value[part];
                } else {
                    return match; // Return original if path not found
                }
            }
            
            return value;
        } catch (e) {
            return match; // Return original on error
        }
    });
}

module.exports = { execute };
