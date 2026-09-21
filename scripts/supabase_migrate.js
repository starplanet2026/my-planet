// Supabase migration runner
// Usage: PGPASSWORD=xxx node scripts/supabase_migrate.js <sql_file_path>
const { Client } = require('pg');
const fs = require('fs');

async function main() {
  const password = process.env.PGPASSWORD;
  if (!password) {
    console.error('Error: PGPASSWORD environment variable not set');
    process.exit(1);
  }
  const sqlFile = process.argv[2];
  if (!sqlFile) {
    console.error('Error: SQL file path required');
    process.exit(1);
  }

  const client = new Client({
    host: 'db.zsqnpwvkbkwiokokldfv.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to Supabase');
    const sql = fs.readFileSync(sqlFile, 'utf8');
    console.log('Executing:', sqlFile);
    await client.query(sql);
    console.log('Done!');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}
main();
