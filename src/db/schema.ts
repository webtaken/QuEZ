import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uuid,
  index,
  numeric,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

// --- better-auth managed tables ---

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  creditBalance: numeric('credit_balance', { precision: 12, scale: 4, mode: 'number' })
    .notNull()
    .default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  idToken: text('id_token'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// --- App tables ---

export const quizzes = pgTable('quizzes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  topic: text('topic').notNull(),
  audience: text('audience').notNull(),
  difficulty: text('difficulty').notNull().default('medium'),
  language: text('language').notNull().default('en'),
  isPublic: boolean('is_public').notNull().default(false),
  coverEmoji: text('cover_emoji').default('🧠'),
  musicTrack: text('music_track'),
  playCount: integer('play_count').notNull().default(0),
  activeLeafId: uuid('active_leaf_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const questions = pgTable('questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  quizId: uuid('quiz_id')
    .notNull()
    .references(() => quizzes.id, { onDelete: 'cascade' }),
  order: integer('order').notNull(),
  text: text('text').notNull(),
  type: text('type').notNull().default('multiple_choice'),
  options: jsonb('options').notNull().$type<string[]>(),
  correctIndex: integer('correct_index').notNull(),
  explanation: text('explanation'),
  timeLimit: integer('time_limit').notNull().default(30),
})

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    quizId: uuid('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'user' | 'assistant'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parts: jsonb('parts').notNull().$type<any[]>(),
    parentId: uuid('parent_id').references((): AnyPgColumn => chatMessages.id, {
      onDelete: 'cascade',
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    quizSnapshot: jsonb('quiz_snapshot').$type<any>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('chat_messages_quiz_id_idx').on(t.quizId),
    index('chat_messages_parent_id_idx').on(t.parentId),
  ]
)

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey(), // client-generated uuid (newId)
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    quizId: uuid('quiz_id').references(() => quizzes.id, { onDelete: 'cascade' }), // null until first save
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    r2Key: text('r2_key').notNull(),
    kind: text('kind').notNull(), // 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'text' | 'image'
    status: text('status').notNull().default('pending'), // 'pending' | 'ready' | 'error'
    extractedText: text('extracted_text'),
    errorMessage: text('error_message'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meta: jsonb('meta').$type<Record<string, any>>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('attachments_quiz_id_idx').on(t.quizId),
    index('attachments_user_id_idx').on(t.userId),
  ]
)

export const creditTransactions = pgTable(
  'credit_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Positive = grant, negative = debit. balanceAfter snapshots users.credit_balance
    // right after this row's delta was applied.
    amount: numeric('amount', { precision: 12, scale: 4, mode: 'number' }).notNull(),
    balanceAfter: numeric('balance_after', { precision: 12, scale: 4, mode: 'number' }).notNull(),
    type: text('type').notNull(), // 'signup_grant' | 'manual_grant' | 'chat' | 'ocr'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: jsonb('metadata').$type<Record<string, any>>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('credit_transactions_user_created_idx').on(t.userId, t.createdAt)]
)

export type User = typeof users.$inferSelect
export type Quiz = typeof quizzes.$inferSelect
export type Question = typeof questions.$inferSelect
export type ChatMessage = typeof chatMessages.$inferSelect
export type Attachment = typeof attachments.$inferSelect
export type CreditTransaction = typeof creditTransactions.$inferSelect
export type NewQuiz = typeof quizzes.$inferInsert
export type NewQuestion = typeof questions.$inferInsert
export type NewChatMessage = typeof chatMessages.$inferInsert
export type NewAttachment = typeof attachments.$inferInsert
export type NewCreditTransaction = typeof creditTransactions.$inferInsert
