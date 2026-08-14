import 'dotenv/config';
import { getSystemStatsInternal } from '../src/gateway/vramMonitor.js';
import { postHeartbeat } from '../worker/gatewayClient.js';

async function main() {
  const stats = await getSystemStatsInternal();
  console.log('Current local hardware stats:');
  console.log(`- Device: ${stats.device}`);
  console.log(`- Used VRAM: ${(stats.vramUsedMb / 1024).toFixed(2)} GB (${stats.vramUsedMb} MB)`);
  console.log(`- Free VRAM: ${(stats.vramFreeMb / 1024).toFixed(2)} GB (${stats.vramFreeMb} MB)`);
  console.log(`- Total VRAM: ${(stats.vramTotalMb / 1024).toFixed(2)} GB`);

  await postHeartbeat({
    device: stats.device,
    vramUsedMb: stats.vramUsedMb,
    vramTotalMb: stats.vramTotalMb,
    vramFreeMb: stats.vramFreeMb,
    systemRamUsedMb: stats.systemRamTotalMb - stats.systemRamFreeMb,
    systemRamTotalMb: stats.systemRamTotalMb,
    comfyOnline: stats.status === 'ONLINE',
    reclaimableVramMb: stats.reclaimableVramMb,
    freeVramHandledReclaimedMb: stats.vramFreeMb,
  });

  console.log('Successfully posted updated telemetry to https://myaiimagegen.vercel.app');
}

main().catch(console.error);
