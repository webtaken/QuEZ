import 'dotenv/config'
import { db } from './index'
import { users, quizzes, questions } from './schema'

const SEED_USER_ID = 'seed-user-001'

const SEED_QUIZZES = [
  {
    title: 'Cell Division & Mitosis',
    description: 'Test your knowledge of cell division processes',
    topic: 'Biology',
    audience: 'High School',
    difficulty: 'medium' as const,
    coverEmoji: '🧬',
    playCount: 1842,
    questions: [
      { text: 'What is the first phase of mitosis?', options: ['Prophase', 'Metaphase', 'Anaphase', 'Telophase'], correctIndex: 0, explanation: 'Prophase is the first stage where chromosomes condense and become visible.' },
      { text: 'How many chromosomes does a human somatic cell have?', options: ['23', '46', '92', '12'], correctIndex: 1, explanation: 'Human somatic cells have 46 chromosomes (23 pairs).' },
      { text: 'Cell division that produces gametes is called:', options: ['Mitosis', 'Binary fission', 'Meiosis', 'Budding'], correctIndex: 2, explanation: 'Meiosis produces gametes (sex cells) with half the chromosome number.' },
    ],
  },
  {
    title: 'Linear Algebra Essentials',
    description: 'Vectors, matrices, and transformations',
    topic: 'Mathematics',
    audience: 'Undergraduate',
    difficulty: 'hard' as const,
    coverEmoji: '📐',
    playCount: 934,
    questions: [
      { text: 'What is the determinant of the identity matrix?', options: ['0', '1', '-1', 'Undefined'], correctIndex: 1, explanation: 'The determinant of any identity matrix equals 1.' },
      { text: 'A square matrix with determinant 0 is called:', options: ['Orthogonal', 'Diagonal', 'Singular', 'Symmetric'], correctIndex: 2, explanation: 'A singular matrix has determinant 0 and has no inverse.' },
      { text: 'The dot product of two perpendicular vectors equals:', options: ['1', '-1', '0', 'Infinity'], correctIndex: 2, explanation: 'Perpendicular vectors have a dot product of 0.' },
      { text: 'Eigenvalues of a matrix satisfy which equation?', options: ['Ax = λx', 'Ax = x + λ', 'λA = x', 'A + λ = 0'], correctIndex: 0, explanation: 'The eigenvalue equation is Av = λv where v is the eigenvector.' },
    ],
  },
  {
    title: 'World War II: Key Events',
    description: 'Major battles, dates, and turning points of WWII',
    topic: 'History',
    audience: 'High School',
    difficulty: 'medium' as const,
    coverEmoji: '🌍',
    playCount: 3201,
    questions: [
      { text: 'In which year did World War II begin?', options: ['1937', '1938', '1939', '1940'], correctIndex: 2, explanation: 'WWII began in 1939 when Germany invaded Poland on September 1.' },
      { text: 'The D-Day invasion occurred on which beach in Normandy?', options: ['Gold', 'Omaha', 'Sword', 'All of the above'], correctIndex: 3, explanation: 'D-Day involved multiple beaches including Utah, Omaha, Gold, Juno, and Sword.' },
      { text: 'Which country dropped atomic bombs on Japan?', options: ['USSR', 'UK', 'USA', 'France'], correctIndex: 2, explanation: 'The United States dropped atomic bombs on Hiroshima and Nagasaki in August 1945.' },
      { text: 'Operation Barbarossa was the German invasion of:', options: ['France', 'Britain', 'Soviet Union', 'North Africa'], correctIndex: 2, explanation: 'Operation Barbarossa was the German invasion of the Soviet Union starting June 1941.' },
      { text: 'The Battle of Stalingrad ended in which year?', options: ['1941', '1942', '1943', '1944'], correctIndex: 2, explanation: 'The Battle of Stalingrad ended in early February 1943 with German surrender.' },
    ],
  },
  {
    title: 'Python Programming Basics',
    description: 'Core Python concepts for beginners',
    topic: 'Programming',
    audience: 'General',
    difficulty: 'easy' as const,
    coverEmoji: '🐍',
    playCount: 5412,
    questions: [
      { text: 'Which keyword defines a function in Python?', options: ['function', 'def', 'fn', 'define'], correctIndex: 1, explanation: 'In Python, functions are defined using the "def" keyword.' },
      { text: 'What data type is the result of: type(3.14)?', options: ['int', 'str', 'float', 'double'], correctIndex: 2, explanation: '3.14 is a floating-point number, so type() returns float.' },
      { text: 'How do you create a list in Python?', options: ['(1, 2, 3)', '[1, 2, 3]', '{1, 2, 3}', '<1, 2, 3>'], correctIndex: 1, explanation: 'Lists in Python are created using square brackets [].' },
      { text: 'Which method adds an element to the end of a list?', options: ['push()', 'add()', 'append()', 'insert()'], correctIndex: 2, explanation: 'The append() method adds an element to the end of a list.' },
    ],
  },
  {
    title: 'World Capitals Quiz',
    description: 'Test your knowledge of capital cities around the world',
    topic: 'Geography',
    audience: 'General',
    difficulty: 'easy' as const,
    coverEmoji: '🗺️',
    playCount: 7830,
    questions: [
      { text: 'What is the capital of Australia?', options: ['Sydney', 'Melbourne', 'Canberra', 'Brisbane'], correctIndex: 2, explanation: 'Canberra is the capital of Australia, chosen as a compromise between Sydney and Melbourne.' },
      { text: 'What is the capital of Brazil?', options: ['São Paulo', 'Rio de Janeiro', 'Salvador', 'Brasília'], correctIndex: 3, explanation: 'Brasília became Brazil\'s capital in 1960, replacing Rio de Janeiro.' },
      { text: 'What is the capital of Canada?', options: ['Toronto', 'Vancouver', 'Ottawa', 'Montreal'], correctIndex: 2, explanation: 'Ottawa is the capital of Canada, located in Ontario.' },
      { text: 'What is the capital of Japan?', options: ['Osaka', 'Kyoto', 'Tokyo', 'Hiroshima'], correctIndex: 2, explanation: 'Tokyo has been Japan\'s capital since 1869.' },
      { text: 'What is the capital of South Africa?', options: ['Cape Town', 'Johannesburg', 'Pretoria', 'Durban'], correctIndex: 2, explanation: 'Pretoria is South Africa\'s executive capital (it has three capitals total).' },
    ],
  },
  {
    title: 'Philosophy: Ancient Greece',
    description: 'Socrates, Plato, Aristotle, and the foundations of Western philosophy',
    topic: 'Philosophy',
    audience: 'Undergraduate',
    difficulty: 'medium' as const,
    coverEmoji: '🏛️',
    playCount: 621,
    questions: [
      { text: 'Socrates believed wisdom begins with:', options: ['Reading books', 'Knowing you know nothing', 'Political power', 'Mathematical proof'], correctIndex: 1, explanation: '"I know that I know nothing" — Socratic ignorance is the starting point of wisdom.' },
      { text: "Plato's allegory of the cave illustrates:", options: ['The nature of shadows', 'Perception vs. reality', 'Political corruption', 'The value of fire'], correctIndex: 1, explanation: 'The allegory illustrates how perceived reality differs from the ideal Forms.' },
      { text: 'Aristotle was a student of:', options: ['Socrates', 'Plato', 'Pythagoras', 'Heraclitus'], correctIndex: 1, explanation: 'Aristotle studied at Plato\'s Academy for 20 years.' },
    ],
  },
  {
    title: 'Basic Economics',
    description: 'Supply, demand, and fundamental economic principles',
    topic: 'Economics',
    audience: 'High School',
    difficulty: 'easy' as const,
    coverEmoji: '📈',
    playCount: 2108,
    questions: [
      { text: 'When demand increases and supply stays the same, price:', options: ['Decreases', 'Stays the same', 'Increases', 'Becomes zero'], correctIndex: 2, explanation: 'Higher demand with fixed supply creates upward pressure on prices.' },
      { text: 'GDP stands for:', options: ['Gross Domestic Product', 'General Development Plan', 'Global Dollar Price', 'Gross Deficit Percentage'], correctIndex: 0, explanation: 'GDP measures the total value of goods and services produced in a country.' },
      { text: 'Inflation refers to:', options: ['Rising unemployment', 'Increase in general price levels', 'Decrease in production', 'Bank interest rates'], correctIndex: 1, explanation: 'Inflation is the rate at which the general level of prices for goods and services rises.' },
      { text: 'An elastic good is one where:', options: ['Supply is fixed', 'Price changes greatly affect demand', 'Price never changes', 'Only luxury buyers purchase it'], correctIndex: 1, explanation: 'Elastic goods see significant changes in demand when prices change.' },
    ],
  },
  {
    title: 'Human Anatomy: The Heart',
    description: 'Chambers, valves, and how the heart works',
    topic: 'Biology',
    audience: 'Undergraduate',
    difficulty: 'medium' as const,
    coverEmoji: '❤️',
    playCount: 1455,
    questions: [
      { text: 'How many chambers does the human heart have?', options: ['2', '3', '4', '5'], correctIndex: 2, explanation: 'The human heart has 4 chambers: left atrium, right atrium, left ventricle, right ventricle.' },
      { text: 'The mitral valve separates which chambers?', options: ['Right atrium and ventricle', 'Left atrium and ventricle', 'Two ventricles', 'Heart and aorta'], correctIndex: 1, explanation: 'The mitral (bicuspid) valve separates the left atrium and left ventricle.' },
      { text: 'Deoxygenated blood enters the heart through the:', options: ['Aorta', 'Pulmonary artery', 'Vena cava', 'Pulmonary vein'], correctIndex: 2, explanation: 'Deoxygenated blood returns to the right atrium via the superior and inferior vena cava.' },
    ],
  },
  {
    title: 'Literary Classics',
    description: 'Famous authors and their works across centuries',
    topic: 'Literature',
    audience: 'General',
    difficulty: 'medium' as const,
    coverEmoji: '📚',
    playCount: 889,
    questions: [
      { text: 'Who wrote "Pride and Prejudice"?', options: ['Charlotte Brontë', 'Jane Austen', 'Mary Shelley', 'George Eliot'], correctIndex: 1, explanation: 'Jane Austen published Pride and Prejudice in 1813.' },
      { text: '"1984" was written by:', options: ['Aldous Huxley', 'Ray Bradbury', 'George Orwell', 'H.G. Wells'], correctIndex: 2, explanation: 'George Orwell wrote 1984, published in 1949.' },
      { text: 'In which Shakespeare play does Ophelia appear?', options: ['Othello', 'Macbeth', 'King Lear', 'Hamlet'], correctIndex: 3, explanation: 'Ophelia is Hamlet\'s love interest in Shakespeare\'s Hamlet.' },
      { text: '"Don Quixote" was written in which language?', options: ['Portuguese', 'Italian', 'Spanish', 'French'], correctIndex: 2, explanation: 'Cervantes wrote Don Quixote in Spanish, published in 1605.' },
    ],
  },
  {
    title: 'Elementary Math Fun',
    description: 'Basic arithmetic and numbers for young learners',
    topic: 'Mathematics',
    audience: 'Elementary School',
    difficulty: 'easy' as const,
    coverEmoji: '🔢',
    playCount: 9201,
    questions: [
      { text: 'What is 7 × 8?', options: ['54', '56', '58', '64'], correctIndex: 1, explanation: '7 × 8 = 56. You can remember: 5, 6, 7, 8 → 56 = 7 × 8!' },
      { text: 'What shape has 3 sides?', options: ['Square', 'Rectangle', 'Triangle', 'Circle'], correctIndex: 2, explanation: 'A triangle has 3 sides and 3 angles.' },
      { text: 'What is half of 100?', options: ['25', '40', '50', '75'], correctIndex: 2, explanation: 'Half of 100 is 50, because 50 + 50 = 100.' },
      { text: 'Which number is the largest?', options: ['99', '100', '101', '98'], correctIndex: 2, explanation: '101 is the largest because it comes after 100.' },
      { text: 'How many seconds are in 1 minute?', options: ['10', '30', '60', '100'], correctIndex: 2, explanation: 'There are 60 seconds in 1 minute.' },
    ],
  },
  {
    title: 'JavaScript Fundamentals',
    description: 'Core JS concepts: variables, functions, and async',
    topic: 'Programming',
    audience: 'Professional',
    difficulty: 'medium' as const,
    coverEmoji: '⚡',
    playCount: 4322,
    questions: [
      { text: 'Which keyword creates a block-scoped variable?', options: ['var', 'let', 'function', 'global'], correctIndex: 1, explanation: '"let" (and "const") are block-scoped, unlike "var" which is function-scoped.' },
      { text: 'What does "===" check in JavaScript?', options: ['Value only', 'Type only', 'Value and type', 'Neither'], correctIndex: 2, explanation: '=== (strict equality) checks both value and type, unlike == which coerces types.' },
      { text: 'Promises handle:', options: ['Synchronous code', 'Asynchronous operations', 'Memory allocation', 'DOM manipulation'], correctIndex: 1, explanation: 'Promises represent the eventual completion (or failure) of asynchronous operations.' },
      { text: 'Array.map() returns:', options: ['The original array', 'A new array', 'Undefined', 'A number'], correctIndex: 1, explanation: 'map() creates and returns a new array with each element transformed by the callback.' },
    ],
  },
  {
    title: 'Climate Science',
    description: 'Climate change, greenhouse gases, and Earth\'s systems',
    topic: 'Science',
    audience: 'High School',
    difficulty: 'medium' as const,
    coverEmoji: '🌡️',
    playCount: 2677,
    questions: [
      { text: 'Which gas is the primary driver of human-caused climate change?', options: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Argon'], correctIndex: 2, explanation: 'CO₂ from burning fossil fuels is the main greenhouse gas driving climate change.' },
      { text: 'The greenhouse effect is:', options: ['Harmful by definition', 'Essential for life on Earth', 'Caused only by humans', 'A recent discovery'], correctIndex: 1, explanation: 'The natural greenhouse effect keeps Earth warm enough to support life; human enhancement is the problem.' },
      { text: 'Sea level rise is caused mainly by:', options: ['Ocean currents', 'Melting ice and thermal expansion', 'Underwater volcanoes', 'Tides getting stronger'], correctIndex: 1, explanation: 'Rising seas result from melting glaciers/ice sheets and water expanding as it warms.' },
      { text: 'The Paris Agreement aims to limit warming to:', options: ['1°C above pre-industrial levels', '1.5°C above pre-industrial levels', '3°C above current levels', '5°C by 2100'], correctIndex: 1, explanation: 'The Paris Agreement targets limiting global warming to 1.5°C above pre-industrial levels.' },
    ],
  },
]

async function seed() {
  console.log('Seeding database...')

  // Upsert seed user
  await db
    .insert(users)
    .values({
      id: SEED_USER_ID,
      name: 'QuEZ Team',
      email: 'team@quez.app',
      emailVerified: true,
      image: null,
    })
    .onConflictDoNothing()

  for (const q of SEED_QUIZZES) {
    const [quiz] = await db
      .insert(quizzes)
      .values({
        userId: SEED_USER_ID,
        title: q.title,
        description: q.description,
        topic: q.topic,
        audience: q.audience,
        difficulty: q.difficulty,
        coverEmoji: q.coverEmoji,
        playCount: q.playCount,
        isPublic: true,
        language: 'en',
      })
      .returning()

    await db.insert(questions).values(
      q.questions.map((question, i) => ({
        quizId: quiz.id,
        order: i + 1,
        text: question.text,
        type: 'multiple_choice' as const,
        options: question.options,
        correctIndex: question.correctIndex,
        explanation: question.explanation,
        timeLimit: 30,
      }))
    )

    console.log(`  ✓ ${q.title}`)
  }

  console.log(`Seeded ${SEED_QUIZZES.length} quizzes.`)
  process.exit(0)
}

seed().catch((e) => {
  console.error(e)
  process.exit(1)
})
