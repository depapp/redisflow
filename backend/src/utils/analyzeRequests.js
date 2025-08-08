const { ioredisClient } = require('../config/redis');

async function analyzeRequests() {
    console.log('\n📊 Analyzing Recent API Requests\n');
    console.log('=' .repeat(50));
    
    try {
        // Connect to Redis
        console.log('Connecting to Redis...');
        await ioredisClient.ping();
        console.log('✅ Connected to Redis\n');
        
        // Get recent API requests
        const requests = await ioredisClient.xrevrange(
            'api:requests',
            '+',
            '-',
            'COUNT',
            1000
        );
        
        console.log(`Found ${requests.length} recent API requests\n`);
        
        // Parse and analyze requests
        const workflowCreations = [];
        const ipCounts = {};
        const userAgents = {};
        
        for (const [id, fields] of requests) {
            const data = JSON.parse(fields[1]); // fields is ['data', JSON string]
            
            // Track workflow creation attempts
            if (data.method === 'POST' && data.path === '/api/workflows') {
                workflowCreations.push(data);
                
                // Count by IP
                ipCounts[data.ip] = (ipCounts[data.ip] || 0) + 1;
                
                // Count by user agent
                const ua = data.userAgent || 'Unknown';
                userAgents[ua] = (userAgents[ua] || 0) + 1;
            }
        }
        
        console.log(`📝 Workflow Creation Attempts: ${workflowCreations.length}\n`);
        
        if (workflowCreations.length > 0) {
            // Show recent workflow creations
            console.log('Recent Workflow Creations (last 10):');
            console.log('-'.repeat(50));
            
            const recent = workflowCreations.slice(0, 10);
            for (const req of recent) {
                console.log(`  ${req.timestamp}`);
                console.log(`    IP: ${req.ip}`);
                console.log(`    User-Agent: ${req.userAgent || 'None'}`);
                console.log(`    Origin: ${req.origin || 'None'}`);
                console.log(`    Referer: ${req.referer || 'None'}`);
                console.log('');
            }
            
            // Show IP addresses creating workflows
            console.log('\nTop IPs Creating Workflows:');
            console.log('-'.repeat(50));
            const sortedIPs = Object.entries(ipCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10);
            
            for (const [ip, count] of sortedIPs) {
                console.log(`  ${ip}: ${count} workflows`);
                
                // Check if this IP has been rate limited
                const rateLimitKey = `workflow:creation:ip:${ip}`;
                const attempts = await ioredisClient.get(rateLimitKey);
                if (attempts) {
                    console.log(`    (Current hour attempts: ${attempts})`);
                }
            }
            
            // Show user agents
            console.log('\nUser Agents Creating Workflows:');
            console.log('-'.repeat(50));
            const sortedAgents = Object.entries(userAgents)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5);
            
            for (const [agent, count] of sortedAgents) {
                const shortAgent = agent.length > 80 ? agent.substring(0, 80) + '...' : agent;
                console.log(`  ${shortAgent}: ${count} workflows`);
                
                // Check if it's a bot
                const botPatterns = [/bot/i, /crawler/i, /spider/i, /curl/i, /python/i];
                const isBot = botPatterns.some(pattern => pattern.test(agent));
                if (isBot) {
                    console.log(`    ⚠️  Detected as BOT`);
                }
            }
            
            // Analyze patterns
            console.log('\n🔍 Pattern Analysis:');
            console.log('-'.repeat(50));
            
            // Check for rapid creation
            const timeWindows = {};
            for (const req of workflowCreations) {
                const minute = req.timestamp.substring(0, 16); // Group by minute
                timeWindows[minute] = (timeWindows[minute] || 0) + 1;
            }
            
            const suspiciousMinutes = Object.entries(timeWindows)
                .filter(([_, count]) => count > 3)
                .sort((a, b) => b[1] - a[1]);
            
            if (suspiciousMinutes.length > 0) {
                console.log('⚠️  Suspicious Activity Detected:');
                for (const [minute, count] of suspiciousMinutes) {
                    console.log(`  ${minute}: ${count} workflows created in 1 minute`);
                }
            }
            
            // Check for missing origin/referer
            const directAPICalls = workflowCreations.filter(req => !req.origin && !req.referer);
            if (directAPICalls.length > 0) {
                console.log(`\n⚠️  Direct API Calls (no origin/referer): ${directAPICalls.length}`);
                console.log('  These might be from:');
                console.log('  - API testing tools (Postman, curl)');
                console.log('  - Automated scripts');
                console.log('  - Search engine crawlers');
            }
        }
        
        // Get current workflows
        const workflowKeys = await ioredisClient.keys('workflow:*');
        const actualWorkflows = workflowKeys.filter(key => key.match(/^workflow:[a-f0-9-]+$/));
        
        console.log('\n📈 Current Status:');
        console.log('-'.repeat(50));
        console.log(`  Total Workflows in Database: ${actualWorkflows.length}`);
        
        // Check for workflows with default name
        let defaultNameCount = 0;
        for (const key of actualWorkflows) {
            const workflow = await ioredisClient.get(key);
            if (workflow) {
                const parsed = JSON.parse(workflow);
                if (parsed.name === 'Workflow' && (!parsed.nodes || parsed.nodes.length === 0)) {
                    defaultNameCount++;
                }
            }
        }
        
        if (defaultNameCount > 0) {
            console.log(`  ⚠️  Empty workflows with default name: ${defaultNameCount}`);
            console.log('     These are likely from automated creation or testing');
        }
        
        console.log('\n✅ Analysis completed!\n');
        
    } catch (error) {
        console.error('❌ Error during analysis:', error);
    } finally {
        await ioredisClient.quit();
        process.exit(0);
    }
}

// Run the analysis
analyzeRequests();
