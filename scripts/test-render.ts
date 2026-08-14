import WebSocket from 'ws';
import { buildComfyUiWorkflow } from '../src/gateway/workflowMapper.js';

async function testRender() {
  const comfyUrl = 'http://127.0.0.1:8188';
  const workflow = buildComfyUiWorkflow({
    prompt: 'A sleek cybernetic robotic cat sitting on a neon rooftop, 8k, photorealistic',
    mediaType: 'image_fast',
    aspectRatio: '1:1',
    steps: 4,
    cfg: 1.0,
  });

  const clientId = `test_${Date.now()}`;
  const wsUrl = `ws://127.0.0.1:8188/ws?clientId=${clientId}`;
  console.log(`Connecting to WebSocket: ${wsUrl}`);
  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    ws.on('open', async () => {
      console.log('WebSocket connected. Submitting prompt...');
      try {
        const res = await fetch(`${comfyUrl}/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: workflow, client_id: clientId }),
        });
        const data = await res.json();
        console.log('Prompt response:', data);
      } catch (err) {
        console.error('Failed to submit prompt:', err);
        reject(err);
      }
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'executing') {
        console.log(`[ComfyUI] Node executing: ${msg.data.node}`);
      } else if (msg.type === 'progress') {
        console.log(`[ComfyUI] Progress: ${msg.data.value}/${msg.data.max}`);
      } else if (msg.type === 'executed') {
        console.log('[ComfyUI] Execution finished successfully!', msg.data);
        ws.close();
        resolve();
      } else if (msg.type === 'execution_error') {
        console.error('[ComfyUI] Execution error:', msg.data);
        ws.close();
        reject(new Error(msg.data.exception_message));
      }
    });

    ws.on('error', (err) => {
      console.error('WS error:', err);
      reject(err);
    });
  });

  console.log('Render test complete!');
}

testRender().catch(console.error);
