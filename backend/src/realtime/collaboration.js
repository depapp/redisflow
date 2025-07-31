const { ioredisClient, createSubscriber, createPubSubClient } = require('../config/redis');

// Store active users per workflow
const activeUsers = new Map();

function setupRealtimeHandlers(io) {
    const subscriber = createSubscriber();
    const publisher = createPubSubClient();
    
    io.on('connection', (socket) => {
        console.log(`New client connected: ${socket.id}`);
        
        // User joins a workflow
        socket.on('join-workflow', async (data) => {
            const { workflowId, userId, userName } = data;
            const roomKey = `workflow:${workflowId}`;
            
            // Join Socket.io room
            socket.join(roomKey);
            socket.userId = userId;
            socket.workflowId = workflowId;
            
            // Track user presence in Redis
            await ioredisClient.sadd(`presence:${workflowId}`, userId);
            await ioredisClient.sadd(`workflow:${workflowId}:users`, userId); // For stats tracking
            await ioredisClient.hset(`user:${userId}`, {
                name: userName,
                socketId: socket.id,
                workflowId: workflowId,
                joinedAt: Date.now()
            });
            
            // Subscribe to workflow changes
            await subscriber.subscribe(`${roomKey}:changes`);
            
            // Get current users in workflow
            const currentUsers = await ioredisClient.smembers(`presence:${workflowId}`);
            const userDetails = await Promise.all(
                currentUsers.map(async (uid) => {
                    const details = await ioredisClient.hgetall(`user:${uid}`);
                    return { userId: uid, ...details };
                })
            );
            
            // Notify others of new user
            socket.to(roomKey).emit('user-joined', {
                userId,
                userName,
                timestamp: Date.now()
            });
            
            // Send current users to new joiner
            socket.emit('current-users', userDetails);
            
            console.log(`User ${userId} joined workflow ${workflowId}`);
        });
        
        // Handle cursor movements
        socket.on('cursor-move', async (data) => {
            const { workflowId, position, userId } = data;
            const roomKey = `workflow:${workflowId}`;
            
            // Broadcast cursor position to others in the workflow
            socket.to(roomKey).emit('cursor-update', {
                userId,
                position,
                timestamp: Date.now()
            });
            
            // Store cursor position in Redis for late joiners
            await ioredisClient.hset(`cursor:${workflowId}:${userId}`, {
                x: position.x,
                y: position.y,
                timestamp: Date.now()
            });
        });
        
        // Handle workflow changes
        socket.on('workflow-change', async (data) => {
            const { workflowId, change, userId } = data;
            const roomKey = `workflow:${workflowId}`;
            
            // Store change in Redis stream for history
            await ioredisClient.xadd(
                `history:${workflowId}`,
                '*',
                'userId', userId,
                'changeType', change.type,
                'change', JSON.stringify(change),
                'timestamp', Date.now()
            );
            
            // Publish change to Redis pub/sub
            await publisher.publish(`${roomKey}:changes`, JSON.stringify({
                userId,
                change,
                timestamp: Date.now()
            }));
            
            // Broadcast to other users in the workflow
            socket.to(roomKey).emit('workflow-update', {
                userId,
                change,
                timestamp: Date.now()
            });
        });
        
        // Handle node selection
        socket.on('node-select', async (data) => {
            const { workflowId, nodeId, userId } = data;
            const roomKey = `workflow:${workflowId}`;
            
            // Store selection in Redis
            await ioredisClient.hset(`selection:${workflowId}`, userId, nodeId);
            
            // Broadcast selection to others
            socket.to(roomKey).emit('node-selected', {
                userId,
                nodeId,
                timestamp: Date.now()
            });
        });
        
        // Handle typing indicators
        socket.on('typing-start', async (data) => {
            const { workflowId, nodeId, userId } = data;
            const roomKey = `workflow:${workflowId}`;
            
            socket.to(roomKey).emit('user-typing', {
                userId,
                nodeId,
                isTyping: true
            });
        });
        
        socket.on('typing-stop', async (data) => {
            const { workflowId, nodeId, userId } = data;
            const roomKey = `workflow:${workflowId}`;
            
            socket.to(roomKey).emit('user-typing', {
                userId,
                nodeId,
                isTyping: false
            });
        });
        
        // Handle disconnection
        socket.on('disconnect', async () => {
            if (socket.userId && socket.workflowId) {
                const roomKey = `workflow:${socket.workflowId}`;
                
                // Remove from presence set
                await ioredisClient.srem(`presence:${socket.workflowId}`, socket.userId);
                await ioredisClient.srem(`workflow:${socket.workflowId}:users`, socket.userId);
                
                // Clean up user data
                await ioredisClient.del(`user:${socket.userId}`);
                await ioredisClient.del(`cursor:${socket.workflowId}:${socket.userId}`);
                await ioredisClient.hdel(`selection:${socket.workflowId}`, socket.userId);
                
                // Notify others
                socket.to(roomKey).emit('user-left', {
                    userId: socket.userId,
                    timestamp: Date.now()
                });
                
                console.log(`User ${socket.userId} left workflow ${socket.workflowId}`);
            }
        });
    });
    
    // Handle Redis pub/sub messages
    subscriber.on('message', (channel, message) => {
        const workflowId = channel.split(':')[1];
        const roomKey = `workflow:${workflowId}`;
        
        // Broadcast to all clients in the workflow
        io.to(roomKey).emit('redis-update', JSON.parse(message));
    });
}

// Get workflow activity metrics
async function getWorkflowActivity(workflowId) {
    const [
        activeUserCount,
        historyCount,
        lastActivity
    ] = await Promise.all([
        ioredisClient.scard(`presence:${workflowId}`),
        ioredisClient.xlen(`history:${workflowId}`),
        ioredisClient.xrevrange(`history:${workflowId}`, '+', '-', 'COUNT', 1)
    ]);
    
    return {
        activeUsers: activeUserCount,
        totalChanges: historyCount,
        lastActivity: lastActivity[0] ? lastActivity[0][1] : null
    };
}

module.exports = {
    setupRealtimeHandlers,
    getWorkflowActivity
};
