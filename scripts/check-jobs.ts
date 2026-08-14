import 'dotenv/config';
import { getJobs, getHeartbeatStatus } from '../src/gateway/db/store.pg.js';

async function main() {
  const status = await getHeartbeatStatus();
  console.log('Heartbeat Status:');
  console.log(JSON.stringify(status, null, 2));

  const jobs = await getJobs(5);
  console.log('\nLast 5 jobs:');
  for (const j of jobs) {
    console.log(`- Job ${j.id}: status=${j.status}, phase=${j.phase}, error="${j.error}", prompt="${j.prompt.slice(0, 60)}..."`);
  }
}

main().catch(console.error);
