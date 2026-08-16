import { ConfigService } from '@nestjs/config';
import { LangGraphPostgresCheckpointerService } from '../src/infrastructure/langgraph/langgraph-postgres-checkpointer.service';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to set up LangGraph checkpoints');
}

const config = new ConfigService({ database: { url: databaseUrl } });
const checkpointer = new LangGraphPostgresCheckpointerService(config);

try {
  await checkpointer.setup();
  process.stdout.write('LangGraph PostgreSQL checkpoint schema is ready.\n');
} finally {
  await checkpointer.onModuleDestroy();
}
