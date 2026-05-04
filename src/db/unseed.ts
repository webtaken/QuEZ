import 'dotenv/config'
import { db } from './index'
import { users } from './schema'
import { eq } from 'drizzle-orm'

const SEED_USER_ID = 'seed-user-001'

async function unseed() {
  console.log(`Removing seed user "${SEED_USER_ID}" and cascading data...`)

  const deleted = await db.delete(users).where(eq(users.id, SEED_USER_ID)).returning({ id: users.id })

  if (deleted.length === 0) {
    console.log('No seed user found. Nothing to remove.')
  } else {
    console.log(`Removed seed user. Quizzes + questions cascaded via FK ON DELETE CASCADE.`)
  }

  process.exit(0)
}

unseed().catch((e) => {
  console.error(e)
  process.exit(1)
})
