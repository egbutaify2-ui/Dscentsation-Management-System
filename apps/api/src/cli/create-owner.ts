import argon2 from 'argon2';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { pool } from '../db/pool.js';

function readHidden(promptText: string): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('Owner bootstrap must run in an interactive terminal.'));
  }

  return new Promise((resolve, reject) => {
    stdout.write(promptText);
    stdin.setRawMode(true);
    stdin.resume();
    let value = '';

    const finish = (error?: Error): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };

    const onData = (chunk: Buffer): void => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') return finish(new Error('Owner bootstrap cancelled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const email = (await prompt.question('Owner email: ')).trim().toLowerCase();
    const displayName = (await prompt.question('Owner display name: ')).trim();
    prompt.close();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new Error('A valid email address is required.');
    }
    if (!displayName || displayName.length > 120) {
      throw new Error('Display name must contain between 1 and 120 characters.');
    }

    const password = await readHidden('Owner password (minimum 12 characters): ');
    const confirmation = await readHidden('Confirm password: ');
    if (password.length < 12) throw new Error('Password must contain at least 12 characters.');
    if (password !== confirmation) throw new Error('Passwords do not match.');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('dms.initial-owner-bootstrap'))");
      const existingOwner = await client.query(
        "SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'OWNER' LIMIT 1",
      );
      if (existingOwner.rowCount) {
        throw new Error(
          'An Owner account already exists. Bootstrap is for the initial Owner only.',
        );
      }

      const role = await client.query<{ id: string }>("SELECT id FROM roles WHERE code = 'OWNER'");
      if (!role.rows[0]) throw new Error('Roles are not seeded. Run pnpm db:migrate first.');

      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO users(email_normalized, display_name, password_hash, role_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [email, displayName, passwordHash, role.rows[0].id],
      );
      const ownerId = inserted.rows[0]?.id;
      if (!ownerId) throw new Error('Owner account could not be created.');

      await client.query(
        `INSERT INTO audit_logs(actor_user_id, action, entity_type, entity_id, safe_metadata)
         VALUES ($1, 'auth.owner_bootstrapped', 'user', $1, $2::jsonb)`,
        [ownerId, JSON.stringify({ outcome: 'created_by_cli' })],
      );
      await client.query('COMMIT');
      stdout.write(`Initial Owner account created for ${email}.\n`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    prompt.close();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Owner bootstrap failed.');
  process.exitCode = 1;
});
