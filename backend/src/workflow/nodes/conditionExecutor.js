const vm = require('vm');

async function execute(nodeConfig, inputs, context) {
    const { 
        condition, 
        expression, // Also accept 'expression' from frontend
        operator = 'custom',
        leftValue,
        rightValue,
        timeout = 5000 
    } = nodeConfig;
    
    // Use expression if condition is not provided
    const conditionExpression = condition || expression;
    
    try {
        // Log execution start
        await context.log('info', 'Evaluating condition');
        
        let result = false;
        
        if (operator === 'custom' && conditionExpression) {
            // Custom JavaScript condition
            const sandbox = {
                // Make data available in multiple ways for flexibility
                data: inputs.data || inputs, // If inputs has a data property, use it directly
                inputs,
                input: inputs,
                // Also expose common response fields at top level
                ...(inputs.data && typeof inputs.data === 'object' ? inputs.data : {}),
                Math,
                Date,
                JSON,
                String,
                Number,
                Boolean,
                Array,
                Object,
                // Helper to safely get nested values
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
                }
            };
            
            // Create and run the script
            const script = new vm.Script(`(${conditionExpression})`);
            result = await script.runInNewContext(sandbox, {
                timeout,
                displayErrors: true
            });
            
        } else {
            // Simple comparison operators
            const left = processValue(leftValue, inputs, context);
            const right = processValue(rightValue, inputs, context);
            
            switch (operator) {
                case 'equals':
                case '==':
                    result = left == right;
                    break;
                case 'notEquals':
                case '!=':
                    result = left != right;
                    break;
                case 'strictEquals':
                case '===':
                    result = left === right;
                    break;
                case 'strictNotEquals':
                case '!==':
                    result = left !== right;
                    break;
                case 'greaterThan':
                case '>':
                    result = left > right;
                    break;
                case 'greaterThanOrEqual':
                case '>=':
                    result = left >= right;
                    break;
                case 'lessThan':
                case '<':
                    result = left < right;
                    break;
                case 'lessThanOrEqual':
                case '<=':
                    result = left <= right;
                    break;
                case 'contains':
                    result = String(left).includes(String(right));
                    break;
                case 'notContains':
                    result = !String(left).includes(String(right));
                    break;
                case 'startsWith':
                    result = String(left).startsWith(String(right));
                    break;
                case 'endsWith':
                    result = String(left).endsWith(String(right));
                    break;
                case 'matches':
                    // Regex match
                    try {
                        const regex = new RegExp(right);
                        result = regex.test(String(left));
                    } catch (e) {
                        result = false;
                    }
                    break;
                case 'in':
                    // Check if left is in right (array)
                    if (Array.isArray(right)) {
                        result = right.includes(left);
                    } else {
                        result = false;
                    }
                    break;
                case 'notIn':
                    // Check if left is not in right (array)
                    if (Array.isArray(right)) {
                        result = !right.includes(left);
                    } else {
                        result = true;
                    }
                    break;
                case 'exists':
                    result = left !== null && left !== undefined;
                    break;
                case 'notExists':
                    result = left === null || left === undefined;
                    break;
                case 'empty':
                    result = !left || (typeof left === 'string' && left.trim() === '') || 
                            (Array.isArray(left) && left.length === 0) ||
                            (typeof left === 'object' && Object.keys(left).length === 0);
                    break;
                case 'notEmpty':
                    result = !(!left || (typeof left === 'string' && left.trim() === '') || 
                            (Array.isArray(left) && left.length === 0) ||
                            (typeof left === 'object' && Object.keys(left).length === 0));
                    break;
                default:
                    throw new Error(`Unknown operator: ${operator}`);
            }
        }
        
        // Log result
        await context.log('info', `Condition evaluated to: ${result}`);
        
        // Return result with metadata
        // If condition is false, we should indicate this to stop the flow
        if (!result) {
            return {
                success: false,
                result: false,
                passed: false,
                operator,
                condition: conditionExpression || `${leftValue} ${operator} ${rightValue}`,
                timestamp: new Date().toISOString(),
                message: 'Condition evaluated to false',
                // Pass through the original data for downstream nodes
                data: inputs.data || inputs
            };
        }
        
        return {
            success: true,
            result: true,
            passed: true,
            operator,
            condition: conditionExpression || `${leftValue} ${operator} ${rightValue}`,
            timestamp: new Date().toISOString(),
            // Pass through the original data for downstream nodes
            data: inputs.data || inputs
        };
        
    } catch (error) {
        // Log error
        await context.log('error', `Condition evaluation failed: ${error.message}`);
        
        // Return error information
        return {
            error: true,
            message: 'Condition evaluation failed',
            details: error.message,
            condition: conditionExpression,
            operator
        };
    }
}

// Process value with template variables
function processValue(value, inputs, context) {
    if (typeof value === 'string') {
        // Check if it's a template variable
        if (value.startsWith('{{') && value.endsWith('}}')) {
            const path = value.slice(2, -2).trim();
            return getValueByPath({ ...inputs, ...context.variables }, path);
        }
        
        // Replace inline template variables
        return value.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
            const val = getValueByPath({ ...inputs, ...context.variables }, path.trim());
            return val !== undefined ? val : match;
        });
    }
    
    return value;
}

// Get value by dot notation path
function getValueByPath(obj, path) {
    const keys = path.split('.');
    let result = obj;
    
    for (const key of keys) {
        if (result && typeof result === 'object' && key in result) {
            result = result[key];
        } else {
            return undefined;
        }
    }
    
    return result;
}

module.exports = { execute };
