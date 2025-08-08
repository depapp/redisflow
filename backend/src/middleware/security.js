const rateLimit = require('express-rate-limit');
const { ioredisClient } = require('../config/redis');

// Rate limiter for workflow creation
const createWorkflowLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 workflow creations per windowMs
    message: 'Too many workflows created from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        console.log(`Rate limit exceeded for IP: ${req.ip}`);
        res.status(429).json({
            error: 'Too many workflows created. Please try again later.'
        });
    }
});

// General API rate limiter
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // Limit each IP to 100 requests per minute
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false
});

// Log request details for monitoring
async function logRequest(req, res, next) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
        origin: req.get('origin'),
        referer: req.get('referer')
    };
    
    // Log to Redis stream for analysis
    try {
        await ioredisClient.xadd(
            'api:requests',
            'MAXLEN', '~', '10000', // Keep last 10000 entries
            '*',
            'data', JSON.stringify(logEntry)
        );
        
        // Log workflow creation attempts
        if (req.method === 'POST' && req.path === '/api/workflows') {
            console.log('Workflow creation attempt:', logEntry);
            
            // Track creation attempts by IP
            const ipKey = `workflow:creation:ip:${logEntry.ip}`;
            await ioredisClient.incr(ipKey);
            await ioredisClient.expire(ipKey, 3600); // Expire after 1 hour
        }
    } catch (error) {
        console.error('Error logging request:', error);
    }
    
    next();
}

// Validate workflow creation request
function validateWorkflowCreation(req, res, next) {
    const { name, nodes, connections } = req.body;
    
    // Check if request has valid content
    if (!name || typeof name !== 'string') {
        return res.status(400).json({
            error: 'Workflow name is required and must be a string'
        });
    }
    
    // Prevent empty workflow spam
    if (name === 'Workflow' && (!nodes || nodes.length === 0)) {
        console.log(`Blocked empty workflow creation from IP: ${req.ip}`);
        return res.status(400).json({
            error: 'Cannot create empty workflow with default name. Please add nodes or provide a custom name.'
        });
    }
    
    // Check for suspicious patterns
    if (name.length > 100) {
        return res.status(400).json({
            error: 'Workflow name too long'
        });
    }
    
    // Validate nodes array
    if (nodes && !Array.isArray(nodes)) {
        return res.status(400).json({
            error: 'Nodes must be an array'
        });
    }
    
    // Validate connections array
    if (connections && !Array.isArray(connections)) {
        return res.status(400).json({
            error: 'Connections must be an array'
        });
    }
    
    next();
}

// Check for bot/crawler user agents
function blockBots(req, res, next) {
    const userAgent = req.get('user-agent') || '';
    const botPatterns = [
        /bot/i,
        /crawler/i,
        /spider/i,
        /scraper/i,
        /curl/i,
        /wget/i,
        /python/i,
        /java/i,
        /ruby/i,
        /perl/i,
        /php/i,
        /go-http/i
    ];
    
    const isBot = botPatterns.some(pattern => pattern.test(userAgent));
    
    if (isBot && req.method === 'POST' && req.path === '/api/workflows') {
        console.log(`Blocked bot workflow creation: ${userAgent} from IP: ${req.ip}`);
        return res.status(403).json({
            error: 'Automated workflow creation is not allowed'
        });
    }
    
    next();
}

// CORS validation for workflow creation
function validateOrigin(req, res, next) {
    const origin = req.get('origin');
    const referer = req.get('referer');
    
    // Skip validation for GET requests
    if (req.method === 'GET') {
        return next();
    }
    
    // For POST/PUT/DELETE, check origin
    if (req.method === 'POST' && req.path === '/api/workflows') {
        // If no origin or referer, it might be a direct API call
        if (!origin && !referer) {
            console.log(`Warning: Workflow creation without origin/referer from IP: ${req.ip}`);
            // You can choose to block this or allow it based on your needs
            // return res.status(403).json({ error: 'Direct API access not allowed' });
        }
    }
    
    next();
}

module.exports = {
    createWorkflowLimiter,
    apiLimiter,
    logRequest,
    validateWorkflowCreation,
    blockBots,
    validateOrigin
};
