import 'server-only';
import postgres from 'postgres';

// dashboard_ui 역할로만 접속한다. 승인·설정 변경 함수는 이 역할만 실행할 수 있다.
const globalForSql = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

export const sql =
  globalForSql.sql ??
  postgres(process.env.DATABASE_URL as string, {
    prepare: false, // 트랜잭션 풀러(6543)에서는 prepared statement를 쓸 수 없음
    max: 1,
    idle_timeout: 20,
    ssl: 'require',
  });

if (process.env.NODE_ENV !== 'production') globalForSql.sql = sql;
