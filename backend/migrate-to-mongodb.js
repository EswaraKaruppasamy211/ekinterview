const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    const separator = trimmed.indexOf('=');
    if (!trimmed || trimmed.startsWith('#') || separator < 1) return;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key && !process.env[key]) process.env[key] = value;
  });
}

const stateFile = path.join(__dirname, 'skillbridge-state.json');
const mongoUri = String(process.env.MONGODB_URI || '').trim();
const databaseName = process.env.MONGODB_DATABASE || 'skillbridge';
const collectionName = process.env.MONGODB_STATE_COLLECTION || 'application_state';

async function migrate() {
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required.');
  }
  if (!fs.existsSync(stateFile)) {
    throw new Error(`Local state file was not found: ${stateFile}`);
  }

  const snapshot = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });

  try {
    await client.connect();
    const collection = client.db(databaseName).collection(collectionName);
    await collection.replaceOne(
      { _id: 'skillbridge-state' },
      {
        _id: 'skillbridge-state',
        state: snapshot.state,
        counters: snapshot.counters || {},
        updatedAt: new Date()
      },
      { upsert: true }
    );
    console.log(`Migrated ${snapshot.state?.users?.length || 0} users to MongoDB.`);
  } finally {
    await client.close();
  }
}

migrate().catch(error => {
  console.error(`MongoDB migration failed: ${error.message}`);
  process.exitCode = 1;
});
