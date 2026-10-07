import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, createHash } from 'node:crypto';
import { openDatabase } from './database.js';
import { hashPassword, verifyPassword } from './passwords.js';

const tokenHash = value => createHash('sha256').update(value).digest('hex');
const cookieName = 'auth_session';
const publicUser = user => ({ id: user._id.toString(), email: user.email, createdAt: user.created_at });

export async function createApp({
  mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/linkedin_auth',
  origins = (process.env.FRONTEND_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173').split(',').map(x => x.trim()),
  allowAllOrigins = process.env.ALLOW_ALL_ORIGINS === 'true',
  secureCookies = process.env.NODE_ENV === 'production',
  authLimit = 20,
} = {}) {
  const db = await openDatabase(mongoUri);
  const app = express();
  const dummyHash = await hashPassword(randomBytes(32).toString('hex'));
  const cookieOptions = { httpOnly: true, secure: secureCookies, sameSite: 'lax', path: '/api' };
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    // Reject disallowed browser origins, including mutations that do not preflight.
    if (!allowAllOrigins && req.headers.origin && !origins.includes(req.headers.origin)) {
      return res.status(403).json({ message: 'This origin is not allowed.' });
    }
    next();
  });
  app.use(cors({
    origin: (origin, callback) => {
      if (allowAllOrigins || !origin || origins.includes(origin)) return callback(null, origin || true);
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
  }));
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());
  app.use('/api', (req, res, next) => {
    if (req.method === 'POST' && !req.is('application/json')) {
      return res.status(415).json({ message: 'Send a JSON request body.' });
    }
    next();
  });
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: authLimit, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { message: 'Too many attempts. Please try again in 15 minutes.' } });
  app.use('/api/auth/register', limiter);
  app.use('/api/auth/login', limiter);

  function credentials(req, res, next) {
    const { email, password, remember = false } = req.body || {};
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ message: 'Enter a valid email address. Phone sign-in is not supported yet.' });
    }
    if (typeof password !== 'string' || password.length < 1 || password.length > 128) {
      return res.status(400).json({ message: 'Password must be between 1 and 128 characters.' });
    }
    if (typeof remember !== 'boolean') return res.status(400).json({ message: 'Remember must be true or false.' });
    req.credentials = { email: email.trim().toLowerCase(), password, remember };
    next();
  }

  async function issueSession(req, res, user, remember) {
    const now = Date.now();
    await db.Session.deleteMany({ expires_at: { $lte: new Date(now) } });
    const oldToken = req.cookies[cookieName];
    if (typeof oldToken === 'string') await db.Session.deleteOne({ token_hash: tokenHash(oldToken) });
    const token = randomBytes(32).toString('hex');
    const duration = (remember ? 30 * 24 : 12) * 60 * 60 * 1000;
    await db.Session.create({ token_hash: tokenHash(token), user_id: user._id, expires_at: new Date(now + duration) });
    res.cookie(cookieName, token, { ...cookieOptions, ...(remember ? { maxAge: duration } : {}) });
  }

  async function authenticated(req, res, next) {
    const token = req.cookies[cookieName];
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return res.status(401).json({ message: 'Please sign in.' });
    const session = await db.Session.findOne({ token_hash: tokenHash(token), expires_at: { $gt: new Date() } }).lean();
    const user = session ? await db.User.findById(session.user_id).lean() : null;
    if (!user) {
      res.clearCookie(cookieName, cookieOptions);
      return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
    }
    req.user = user;
    next();
  }

  app.get('/api/health', async (req, res) => {
    try { await db.connection.db.command({ ping: 1 }); res.json({ status: 'ok', database: 'mongodb' }); }
    catch { res.status(503).json({ status: 'unavailable', database: 'mongodb' }); }
  });
  app.post('/api/auth/register', credentials, async (req, res) => {
    const { email, password, remember } = req.credentials;
    if (password.length < 8) return res.status(400).json({ message: 'Use at least 8 characters for your password.' });
    if (await db.User.exists({ email })) return res.status(409).json({ message: 'An account with this email already exists.' });
    const encoded = await hashPassword(password);
    let user;
    try {
      user = await db.User.create({ email, password_hash: encoded });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ message: 'An account with this email already exists.' });
      throw error;
    }
    await issueSession(req, res, user, remember);
    res.status(201).json({ message: 'Account created successfully.', user: publicUser(user) });
  });
  app.post('/api/auth/login', credentials, async (req, res) => {
    const { email, password, remember } = req.credentials;
    const user = await db.User.findOne({ email }).lean();
    const valid = await verifyPassword(password, user?.password_hash || dummyHash);
    if (!user || !valid) return res.status(401).json({ message: 'Email or password is incorrect.' });
    await issueSession(req, res, user, remember);
    res.json({ message: 'Signed in successfully.', user: publicUser(user) });
  });
  app.get('/api/auth/me', authenticated, (req, res) => res.json({ user: publicUser(req.user) }));
  app.post('/api/auth/logout', async (req, res) => {
    const token = req.cookies[cookieName];
    if (typeof token === 'string') await db.Session.deleteOne({ token_hash: tokenHash(token) });
    res.clearCookie(cookieName, cookieOptions);
    res.json({ message: 'Signed out successfully.' });
  });
  app.use((req, res) => res.status(404).json({ message: 'Endpoint not found.' }));
  app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid JSON.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ message: 'Request is too large.' });
    console.error('Request failed:', error.name || 'Error');
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  });
  return { app, db };
}
