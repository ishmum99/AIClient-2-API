import http from 'http';
import https from 'https';

// SearXNG search helper
function searxngSearch(query) {
    return new Promise((resolve) => {
        const url = 'https://searxng.3stf.com/search?q=' + encodeURIComponent(query) + '&format=json&num_results=3';
        https.get(url, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try {
                    const j = JSON.parse(d);
                    const results = (j.results || []).slice(0, 3).map(r => ({
                        title: r.title,
                        url: r.url,
                        content: (r.content || '').slice(0, 300)
                    }));
                    resolve(JSON.stringify(results));
                } catch (e) { resolve('Search error: ' + e.message + ' raw: ' + d.slice(0, 100)); }
            });
        }).on('error', e => resolve('Search error: ' + e.message));
    });
}

// POST to our API
function apiPost(messages, tools) {
    return new Promise((resolve) => {
        const body = JSON.stringify({ model: 'kimi-k2.5', messages, tools, tool_choice: 'auto' });
        const opts = {
            hostname: 'localhost', port: 3000,
            path: '/v1/chat/completions', method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer 123456',
                'model-provider': 'openai-iflow',
                'Content-Length': Buffer.byteLength(body)
            }
        };
        const req = http.request(opts, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const j = JSON.parse(data);
                    if (res.statusCode >= 400) {
                        console.log(`  [HTTP ${res.statusCode}] Raw error body:`, data.slice(0, 500));
                    }
                    resolve(j);
                }
                catch (e) { resolve({ error: 'JSON parse failed [' + res.statusCode + ']: ' + data.slice(0, 400) }); }
            });
        });
        req.on('error', e => resolve({ error: e.message }));
        req.write(body);
        req.end();
    });
}

const TOOLS = [{
    type: 'function',
    function: {
        name: 'search',
        description: 'Search the web using SearXNG. Use this for any factual lookups.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query' }
            },
            required: ['query']
        }
    }
}];

async function runAgentLoop() {
    const messages = [{
        role: 'user',
        content: 'I need you to search for ALL of these topics and give me a summary: 1) kimi k2 AI model capabilities, 2) deepseek v3 benchmark scores, 3) qwen3 235b performance. Make sure to search for each one separately.'
    }];

    console.log('=== Starting agentic tool-call test (kimi-k2.5 + SearXNG) ===\n');
    let round = 0;
    let totalToolCalls = 0;

    while (round < 10) {
        round++;
        console.log(`--- Round ${round} (messages: ${messages.length}) ---`);

        const resp = await apiPost(messages, TOOLS);

        if (resp.error) {
            console.log('ERROR:', resp.error);
            break;
        }

        const choice = resp.choices?.[0];
        if (!choice) {
            console.log('No choices in response:', JSON.stringify(resp).slice(0, 400));
            break;
        }

        const msg = choice.message;
        console.log('finish_reason:', choice.finish_reason);
        if (msg.content) console.log('content preview:', String(msg.content).slice(0, 100));

        if (msg.tool_calls && msg.tool_calls.length > 0) {
            console.log(`Tool calls this round: ${msg.tool_calls.length}`);
            totalToolCalls += msg.tool_calls.length;

            // Add assistant message with tool calls
            messages.push({ role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls });

            // Execute each tool call
            for (const tc of msg.tool_calls) {
                try {
                    const args = JSON.parse(tc.function.arguments);
                    console.log(`  [${tc.id}] search("${args.query}")`);
                    const result = await searxngSearch(args.query);
                    const parsed = JSON.parse(result);
                    console.log(`  -> ${parsed.length} results`);
                    messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
                } catch (e) {
                    console.log(`  Error executing tool: ${e.message}`);
                    messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Error: ' + e.message });
                }
            }
        } else if (choice.finish_reason === 'stop' || msg.content) {
            console.log('\n=== FINAL ANSWER ===');
            console.log(msg.content);
            console.log(`\nTotal tool calls made: ${totalToolCalls} across ${round} rounds`);
            break;
        } else {
            console.log('Unexpected response:', JSON.stringify(choice).slice(0, 400));
            break;
        }
    }
    console.log('\n=== Test complete ===');
}

runAgentLoop().catch(e => console.error('Fatal:', e.message));
