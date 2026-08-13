import http from 'node:http';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { Server } from 'socket.io';

import { env, isProd } from './config/env.js';
import { migrate } from './db/migrate.js';
import { usingTurso, closeDb } from './db/index.js';
import { notFound, errorHandler } from './middleware/error.js';
import { UPLOAD_DIR, mediaProvider } from './services/media.js';
import { mailProvider } from './services/mail.js';
import { attachSockets } from './sockets/index.js';

import { startScheduler } from './services/scheduler.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import conversationRoutes from './routes/conversations.js';
import messageRoutes from './routes/messages.js';
import mediaRoutes from './routes/media.js';
import pushRoutes from './routes/push.js';
import callRoutes from './routes/calls.js';
import roomRoutes from './routes/rooms.js';
import spaceRoutes from './routes/spaces.js';
import linkRoutes from './routes/links.js';

const app = express();
const server = http.createServer(app);

// Render, Railway and Fly all sit behind a proxy; without this, rate limiting
// sees one IP for everyone and `secure` cookies are dropped.
app.set('trust proxy', 1);

/**
 * CORS.
 *
 * `credentials: true` plus a wildcard origin is silently ignored by browsers,
 * so the allowlist has to be exact. Vercel preview deployments get a fresh
 * subdomain per commit, so those are matched by pattern rather than listed.
 */
const previewOrigin = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl, health checks, same-origin
      if (!isProd) return cb(null, true);
      if (env.clientOrigin.includes(origin)) return cb(null, true);
      if (env.allowVercelPreviews && previewOrigin.test(origin)) return cb(null, true);
      cb(new Error(`Origin not allowed: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
if (!isProd) app.use(morgan('  :method :url :status :response-time[0]ms'));

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d' }));

app.get('/api/health', (req, res) =>
  res.json({
    ok: true,
    app: 'nook',
    media: mediaProvider(),
    mail: mailProvider(),
    time: new Date().toISOString(),
  })
);

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/spaces', spaceRoutes);
app.use('/api/links', linkRoutes);

app.use(notFound);
app.use(errorHandler);

const io = new Server(server, {
  cors: {
    origin: (origin, cb) => {
      if (!origin || !isProd) return cb(null, true);
      if (env.clientOrigin.includes(origin)) return cb(null, true);
      if (env.allowVercelPreviews && previewOrigin.test(origin)) return cb(null, true);
      cb(new Error(`Origin not allowed: ${origin}`));
    },
    credentials: true,
  },
  maxHttpBufferSize: 2e6,
});

/**
 * Without an adapter, two server instances can't see each other's sockets — a
 * message sent to a user connected to instance B never leaves instance A. Redis
 * fixes that. Optional: with no REDIS_URL we run single-instance, as before.
 */
if (process.env.REDIS_URL) {
  try {
    const [{ createAdapter }, { createClient }] = await Promise.all([
      import('@socket.io/redis-adapter'),
      import('redis'),
    ]);
    const pub = createClient({ url: process.env.REDIS_URL });
    const sub = pub.duplicate();
    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));
    console.log('  sockets   Redis adapter attached - horizontal scaling enabled');
  } catch (err) {
    console.error(`  sockets   Redis adapter failed (${err.message}) - staying single-instance`);
  }
}

attachSockets(io);

await migrate();

// An empty database has nothing to look at, so fill it with the demo accounts.
// Also honours SEED_DEMO=1 to re-seed a database that already has data.
const { isEmpty, seedDemoData } = await import('./seed.js');
if ((await isEmpty()) || process.env.SEED_DEMO === '1') {
  await seedDemoData();
}

startScheduler();

server.listen(env.port, () => {
  console.log('');
  console.log('  ╭──────────────────────────────────────────────╮');
  console.log('  │  Nook — server                               │');
  console.log('  ╰──────────────────────────────────────────────╯');
  console.log(`  api       http://localhost:${env.port}/api`);
  console.log(`  sockets   ws://localhost:${env.port}`);
  console.log(`  database  ${usingTurso() ? env.turso.url : 'local file — server/data/nook.db'}`);
  console.log(`  media     ${mediaProvider()}`);
  console.log(`  email     ${mailProvider()}`);
  console.log(`  client    ${env.clientOrigin.join(', ')}`);
  console.log('');
});

const shutdown = () => {
  console.log('\n  closing…');
  io.close();
  closeDb();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
