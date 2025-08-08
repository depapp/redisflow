const { ioredisClient } = require('../config/redis');
const { v4: uuidv4 } = require('uuid');
const { features, isProduction } = require('../config/environment');

const demoWorkflows = [
  {
    id: uuidv4(),
    name: 'API Data Pipeline',
    description: 'Fetch data from API, transform it, and store in Redis',
    nodes: [
      {
        id: 'node_1',
        type: 'httpRequest',
        name: 'Fetch Weather Data',
        config: {
          url: 'https://api.openweathermap.org/data/2.5/weather?q=London&appid=demo',
          method: 'GET'
        },
        position: { x: 100, y: 100 }
      },
      {
        id: 'node_2',
        type: 'transform',
        name: 'Extract Temperature',
        config: {
          script: 'return { temp: data.main.temp, city: data.name }'
        },
        position: { x: 300, y: 100 }
      },
      {
        id: 'node_3',
        type: 'redisSet',
        name: 'Cache Weather Data',
        config: {
          key: 'weather:london',
          value: '${data}',
          ttl: 3600
        },
        position: { x: 500, y: 100 }
      },
      {
        id: 'node_4',
        type: 'logger',
        name: 'Log Success',
        config: {
          message: 'Weather data cached successfully',
          level: 'info'
        },
        position: { x: 700, y: 100 }
      }
    ],
    connections: [
      { id: 'conn_1', source: 'node_1', target: 'node_2' },
      { id: 'conn_2', source: 'node_2', target: 'node_3' },
      { id: 'conn_3', source: 'node_3', target: 'node_4' }
    ]
  },
  {
    id: uuidv4(),
    name: 'Scheduled Data Cleanup',
    description: 'Periodically clean up old data from Redis',
    nodes: [
      {
        id: 'node_1',
        type: 'logger',
        name: 'Start Cleanup',
        config: {
          message: 'Starting data cleanup process',
          level: 'info'
        },
        position: { x: 100, y: 100 }
      },
      {
        id: 'node_2',
        type: 'redisGet',
        name: 'Get Cleanup Config',
        config: {
          key: 'config:cleanup'
        },
        position: { x: 300, y: 100 }
      },
      {
        id: 'node_3',
        type: 'condition',
        name: 'Check if Enabled',
        config: {
          expression: 'data.enabled === true'
        },
        position: { x: 500, y: 100 }
      },
      {
        id: 'node_4',
        type: 'delay',
        name: 'Wait 5 seconds',
        config: {
          duration: 5000
        },
        position: { x: 700, y: 100 }
      },
      {
        id: 'node_5',
        type: 'logger',
        name: 'Cleanup Complete',
        config: {
          message: 'Data cleanup completed',
          level: 'success'
        },
        position: { x: 900, y: 100 }
      }
    ],
    connections: [
      { id: 'conn_1', source: 'node_1', target: 'node_2' },
      { id: 'conn_2', source: 'node_2', target: 'node_3' },
      { id: 'conn_3', source: 'node_3', target: 'node_4', condition: 'true' },
      { id: 'conn_4', source: 'node_4', target: 'node_5' }
    ]
  },
  {
    id: uuidv4(),
    name: 'User Activity Tracker',
    description: 'Track and analyze user activity using Redis features',
    nodes: [
      {
        id: 'node_1',
        type: 'logger',
        name: 'Track Activity',
        config: {
          message: 'Tracking user activity',
          level: 'info'
        },
        position: { x: 100, y: 100 }
      },
      {
        id: 'node_2',
        type: 'redisSet',
        name: 'Update Last Active',
        config: {
          key: 'user:${userId}:lastActive',
          value: '${timestamp}',
          ttl: 86400
        },
        position: { x: 300, y: 100 }
      },
      {
        id: 'node_3',
        type: 'transform',
        name: 'Prepare Analytics',
        config: {
          script: 'return { event: "page_view", timestamp: Date.now() }'
        },
        position: { x: 500, y: 100 }
      },
      {
        id: 'node_4',
        type: 'logger',
        name: 'Activity Recorded',
        config: {
          message: 'User activity recorded successfully',
          level: 'success'
        },
        position: { x: 700, y: 100 }
      }
    ],
    connections: [
      { id: 'conn_1', source: 'node_1', target: 'node_2' },
      { id: 'conn_2', source: 'node_2', target: 'node_3' },
      { id: 'conn_3', source: 'node_3', target: 'node_4' }
    ]
  }
];

async function seedDemoWorkflows(force = false) {
  // Check if demo data is enabled
  if (!features.enableDemoData && !force) {
    console.log('ℹ️  Demo data is disabled in this environment');
    return;
  }
  
  // Never seed in production unless explicitly forced
  if (isProduction && !force) {
    console.log('⚠️  Skipping demo workflow seeding in production environment');
    return;
  }
  
  // Check if workflows already exist
  const existingWorkflows = await ioredisClient.keys('workflow:*');
  const actualWorkflows = existingWorkflows.filter(key => key.match(/^workflow:[a-f0-9-]+$/));
  
  if (actualWorkflows.length > 0 && !force) {
    console.log(`ℹ️  Database already contains ${actualWorkflows.length} workflows. Skipping demo seeding.`);
    return;
  }
  
  console.log('🌱 Seeding demo workflows...');
  
  for (const workflow of demoWorkflows) {
    const workflowData = {
      ...workflow,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      userId: 'demo',
      metrics: {
        executions: Math.floor(Math.random() * 100),
        lastExecuted: new Date(Date.now() - Math.random() * 86400000).toISOString(),
        avgDuration: Math.floor(Math.random() * 5000) + 1000,
        successRate: Math.floor(Math.random() * 30) + 70
      }
    };
    
    // Store workflow
    await ioredisClient.set(
      `workflow:${workflow.id}`,
      JSON.stringify(workflowData)
    );
    
    // Add to sorted set for listing
    await ioredisClient.zadd(
      'workflows:all',
      Date.now(),
      workflow.id
    );
    
    // Add to user's workflows
    await ioredisClient.sadd(
      'user:demo:workflows',
      workflow.id
    );
    
    // Track in popular workflows
    await ioredisClient.zincrby(
      'workflows:popular',
      Math.floor(Math.random() * 50),
      workflow.id
    );
    
    console.log(`✅ Created demo workflow: ${workflow.name}`);
  }
  
  console.log('🎉 Demo workflows seeded successfully!');
}

// Export for use in other modules
module.exports = { seedDemoWorkflows, demoWorkflows };

// Run if called directly
if (require.main === module) {
  // Allow forcing via command line argument
  const force = process.argv.includes('--force');
  
  if (force) {
    console.log('⚠️  Force flag detected - will seed regardless of environment');
  }
  
  seedDemoWorkflows(force)
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error seeding workflows:', err);
      process.exit(1);
    });
}
