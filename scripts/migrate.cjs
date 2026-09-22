// Supabase migration runner - reads password from .env.local
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function tryConnect(host, port, user, password) {
  const client = new Client({
    host,
    port,
    database: 'postgres',
    user,
    password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  });
  try {
    await client.connect();
    return client;
  } catch (e) {
    await client.end().catch(() => {});
    throw e;
  }
}

async function main() {
  const envPath = path.join(__dirname, '..', '.env.local');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/DB_PASSWORD=(.+)/);
  if (!match) {
    console.error('DB_PASSWORD not found in .env.local');
    process.exit(1);
  }
  const password = match[1].trim();

  const projectRoot = path.join(__dirname, '..');
  const sqlFile = process.argv[2];
  if (!sqlFile) {
    console.error('Usage: node scripts/migrate.cjs <sql_file>');
    process.exit(1);
  }

  // Supavisor pooler requires user format: postgres.{project_ref}
  const projectRef = 'zsqnpwvkbkwiokokldfv';
  const hosts = [
    { host: 'aws-0-ap-southeast-2.pooler.supabase.com', port: 5432, label: 'ap-southeast-2 pooler', user: `postgres.${projectRef}` },
    { host: 'aws-0-ap-southeast-1.pooler.supabase.com', port: 5432, label: 'ap-southeast-1 pooler', user: `postgres.${projectRef}` },
    { host: 'aws-0-us-east-1.pooler.supabase.com', port: 5432, label: 'us-east-1 pooler', user: `postgres.${projectRef}` },
  ];

  let client = null;
  for (const h of hosts) {
    process.stdout.write(`Trying ${h.label} (${h.host}:${h.port}, user=${h.user})... `);
    try {
      client = await tryConnect(h.host, h.port, h.user, password);
      console.log('OK!');
      break;
    } catch (e) {
      console.log('FAIL: ' + e.message.substring(0, 80));
    }
  }

  if (!client) {
    console.error('\nAll connection attempts failed');
    process.exit(1);
  }

  try {
    const sql = fs.readFileSync(path.join(projectRoot, sqlFile), 'utf8');
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
