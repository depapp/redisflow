# RedisFlow Backend

Real-time collaborative workflow automation platform powered by Redis.

## Features

- **Real-time Collaboration**: Multiple users can edit workflows simultaneously with live cursors and instant updates
- **Workflow Execution Engine**: Execute workflows with various node types (HTTP, Transform, Redis operations, etc.)
- **Redis-Powered**: Uses Redis for everything - primary database, pub/sub, streams, caching, and more
- **WebSocket Support**: Real-time updates via Socket.io
- **RESTful API**: Complete API for workflow management

## Redis Features Utilized

1. **Primary Database**: Store workflows as JSON documents
2. **Pub/Sub**: Real-time collaboration and updates
3. **Streams**: Event sourcing and execution logs
4. **Sorted Sets**: Efficient workflow sorting and ranking
5. **Sets**: User presence tracking
6. **Hashes**: Execution state management
7. **HyperLogLog**: Unique visitor tracking
8. **Bitmaps**: Activity tracking
9. **TTL**: Automatic cleanup of temporary data
10. **Transactions**: Atomic operations
11. **Lua Scripts**: Complex atomic operations
12. **BullMQ**: Redis-based job queue for workflow execution

## API Endpoints

### Workflows
- `GET /api/workflows` - List all workflows
- `GET /api/workflows/:id` - Get single workflow
- `POST /api/workflows` - Create new workflow
- `PUT /api/workflows/:id` - Update workflow
- `DELETE /api/workflows/:id` - Delete workflow
- `POST /api/workflows/:id/clone` - Clone workflow
- `GET /api/workflows/:id/history` - Get workflow history

### Executions
- `POST /api/executions` - Execute workflow
- `GET /api/executions/:id` - Get execution status
- `GET /api/executions/:id/logs` - Stream execution logs (SSE)
- `POST /api/executions/:id/cancel` - Cancel execution
- `GET /api/executions/workflow/:workflowId` - Get workflow executions

### Health
- `GET /health` - Health check endpoint

## WebSocket Events

### Client → Server
- `join-workflow` - Join a workflow room
- `cursor-move` - Update cursor position
- `workflow-change` - Broadcast workflow changes
- `node-select` - Select a node
- `typing-start` - Start typing indicator
- `typing-stop` - Stop typing indicator

### Server → Client
- `user-joined` - User joined workflow
- `user-left` - User left workflow
- `current-users` - List of current users
- `cursor-update` - Cursor position update
- `workflow-update` - Workflow changes
- `node-selected` - Node selection update
- `user-typing` - Typing indicator

## Node Types

- **httpRequest**: Make HTTP requests
- **transform**: Transform data with scripts
- **redisGet**: Get value from Redis
- **redisSet**: Set value in Redis
- **condition**: Conditional branching
- **delay**: Add delays to workflow
- **logger**: Log messages

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Start production server
npm start
```

## Environment Variables

- `PORT` - Server port (default: 3001)
- `FRONTEND_URL` - Frontend URL for CORS
- `NODE_ENV` - Environment (development/production)

## Architecture

```
├── src/
│   ├── server.js          # Main server file
│   ├── config/
│   │   └── redis.js       # Redis configuration
│   ├── api/
│   │   └── routes/        # API routes
│   ├── workflow/
│   │   └── engine.js      # Workflow execution engine
│   └── realtime/
│       └── collaboration.js # WebSocket handlers
