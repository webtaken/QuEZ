import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db } from './index'
import { users } from './schema'
import { grantCredits } from './credit-queries'

async function main() {
  const [email, amountArg] = process.argv.slice(2)
  const amount = Number(amountArg)
  if (!email || !Number.isFinite(amount) || amount <= 0) {
    console.error('Usage: pnpm credits:grant <email> <amount>')
    process.exit(1)
  }
  const [user] = await db.select().from(users).where(eq(users.email, email))
  if (!user) {
    console.error(`No user found with email ${email}`)
    process.exit(1)
  }
  const balance = await grantCredits({ userId: user.id, amount, type: 'manual_grant' })
  console.log(`Granted ${amount} credits to ${email}. New balance: ${balance}`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
